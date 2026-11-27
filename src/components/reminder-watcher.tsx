import * as React from "react";
import { BellRing, Check, Clock, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  fetchNotesApi,
  formatReminderLabel,
  notifyNotesChanged,
  subscribeNotesChanged,
  updateNoteApi,
  type PortalNote,
} from "@/lib/notes-client";
import {
  installAudioUnlockListeners,
  isGlobalReminderSoundEnabled,
  playReminderChime,
  unlockReminderAudio,
} from "@/lib/reminder-sound";
import { useApp } from "@/lib/store";

const WATCHER_INTERVAL_MS = 10_000;
const SERVER_SYNC_INTERVAL_MS = 30_000;

export function ReminderWatcher() {
  const { me, ready, canViewModule } = useApp();
  const canWatchNotes = Boolean(ready && me && canViewModule("dashboard"));
  const userId = me?.id ?? null;

  const [notes, setNotes] = React.useState<PortalNote[]>([]);
  const [activeAlerts, setActiveAlerts] = React.useState<PortalNote[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [globalSoundOn, setGlobalSoundOn] = React.useState(true);

  const notesRef = React.useRef<PortalNote[]>([]);
  const triggeredKeysRef = React.useRef<Set<string>>(new Set());
  const stopChimeRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  // Unlock browser AudioContext on any click/tap/keypress across the portal
  React.useEffect(() => {
    return installAudioUnlockListeners();
  }, []);

  // Track global reminder sound preference per user
  React.useEffect(() => {
    setGlobalSoundOn(isGlobalReminderSoundEnabled(userId));
    const onPrefChange = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled?: boolean; userId?: string | null }>).detail;
      if (!detail || detail.userId === userId || !detail.userId) {
        setGlobalSoundOn(isGlobalReminderSoundEnabled(userId));
      }
    };
    window.addEventListener("sace:reminder-sound-pref", onPrefChange);
    return () => window.removeEventListener("sace:reminder-sound-pref", onPrefChange);
  }, [userId]);

  const stopActiveChime = React.useCallback(() => {
    if (stopChimeRef.current) {
      stopChimeRef.current();
      stopChimeRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => {
      stopActiveChime();
    };
  }, [stopActiveChime]);

  const evaluateDueReminders = React.useCallback(
    (sourceNotes: PortalNote[]) => {
      if (!canWatchNotes || !userId) {
        setActiveAlerts([]);
        return;
      }

      const nowMs = Date.now();
      const dueNotes = sourceNotes
        .filter((n) => {
          if (!n.reminderAt || n.reminderDismissed) return false;
          const dueMs = new Date(n.reminderAt).getTime();
          return !Number.isNaN(dueMs) && dueMs <= nowMs;
        })
        .sort((a, b) => new Date(a.reminderAt!).getTime() - new Date(b.reminderAt!).getTime());

      setActiveAlerts(dueNotes);

      for (const note of dueNotes) {
        const key = `${note.id}:${note.reminderAt}`;
        if (triggeredKeysRef.current.has(key)) continue;
        triggeredKeysRef.current.add(key);

        if (isGlobalReminderSoundEnabled(userId) && note.soundEnabled) {
          stopActiveChime();
          stopChimeRef.current = playReminderChime({ repeatCount: 3, intervalMs: 1500 });
        }

        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          try {
            const title = note.title.trim() || "Workpulse Notepad Reminder";
            new Notification(title, {
              body: note.content,
              tag: `workpulse-note-reminder-${note.id}`,
              icon: "/sace-logo.svg",
            });
          } catch {
            // Ignore Notification constructor issues on restricted contexts
          }
        }

        if (!note.reminderTriggered) {
          void updateNoteApi(note.id, { reminderTriggered: true })
            .then((updated) => {
              const next = notesRef.current.map((n) => (n.id === updated.id ? updated : n));
              notesRef.current = next;
              setNotes(next);
              notifyNotesChanged(next);
            })
            .catch(() => {
              // Ignore transient network errors; watcher stays active
            });
        }
      }
    },
    [canWatchNotes, userId, stopActiveChime],
  );

  // Sync notes from backend & Notepad component events
  React.useEffect(() => {
    if (!canWatchNotes || !userId) {
      setNotes([]);
      setActiveAlerts([]);
      triggeredKeysRef.current.clear();
      stopActiveChime();
      return;
    }

    let cancelled = false;
    const loadFromServer = async () => {
      try {
        const fetched = await fetchNotesApi();
        if (cancelled) return;
        notesRef.current = fetched;
        setNotes(fetched);
        evaluateDueReminders(fetched);
      } catch {
        // Ignore transient fetch errors
      }
    };

    void loadFromServer();
    const unsubscribe = subscribeNotesChanged((updated) => {
      if (updated) {
        notesRef.current = updated;
        setNotes(updated);
        evaluateDueReminders(updated);
      } else {
        void loadFromServer();
      }
    });

    const syncTimer = window.setInterval(() => {
      void loadFromServer();
    }, SERVER_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(syncTimer);
    };
  }, [canWatchNotes, userId, evaluateDueReminders, stopActiveChime]);

  // Lightweight 10-second background check across all authenticated pages
  React.useEffect(() => {
    if (!canWatchNotes || !userId) return;
    evaluateDueReminders(notesRef.current);
    const timer = window.setInterval(() => {
      evaluateDueReminders(notesRef.current);
    }, WATCHER_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [canWatchNotes, userId, evaluateDueReminders]);

  const handleSnooze5Min = async (note: PortalNote) => {
    void unlockReminderAudio();
    stopActiveChime();
    setBusyId(note.id);
    try {
      const snoozeIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const updated = await updateNoteApi(note.id, {
        reminderAt: snoozeIso,
        reminderTriggered: false,
        reminderDismissed: false,
      });
      const next = notesRef.current.map((n) => (n.id === updated.id ? updated : n));
      notesRef.current = next;
      setNotes(next);
      setActiveAlerts((prev) => prev.filter((a) => a.id !== note.id));
      notifyNotesChanged(next);
      toast.info(`Snoozed for 5 minutes (${formatReminderLabel(snoozeIso)})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not snooze reminder.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (note: PortalNote) => {
    void unlockReminderAudio();
    stopActiveChime();
    setBusyId(note.id);
    try {
      const updated = await updateNoteApi(note.id, {
        reminderDismissed: true,
        reminderTriggered: true,
      });
      const next = notesRef.current.map((n) => (n.id === updated.id ? updated : n));
      notesRef.current = next;
      setNotes(next);
      setActiveAlerts((prev) => prev.filter((a) => a.id !== note.id));
      notifyNotesChanged(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not dismiss reminder.");
    } finally {
      setBusyId(null);
    }
  };

  if (!canWatchNotes || activeAlerts.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed top-4 right-4 z-[90] flex w-[min(390px,calc(100vw-2rem))] flex-col gap-2.5"
      role="region"
      aria-label="Notepad reminder alerts"
    >
      {activeAlerts.map((note) => {
        const isBusy = busyId === note.id;
        const soundActive = globalSoundOn && note.soundEnabled;
        return (
          <div
            key={`${note.id}:${note.reminderAt}`}
            className="rounded-2xl border-2 border-[#5B00A3]/30 bg-white p-4 shadow-2xl ring-1 ring-black/5"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5B00A3]/10 text-[#5B00A3]">
                <BellRing className="h-4 w-4 animate-bounce" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#5B00A3]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#5B00A3]">
                    Reminder Due
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
                    {soundActive ? (
                      <Volume2
                        className="h-3 w-3 text-[#5B00A3]"
                        aria-label="Sound alert enabled"
                      />
                    ) : (
                      <VolumeX className="h-3 w-3 text-muted-foreground" aria-label="Muted" />
                    )}
                    {note.reminderAt && <span>{formatReminderLabel(note.reminderAt)}</span>}
                  </div>
                </div>

                <h4 className="mt-1.5 text-sm font-bold text-foreground truncate">
                  {note.title.trim() || "Personal Notepad Reminder"}
                </h4>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-3 break-words">
                  {note.content}
                </p>

                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => void handleSnooze5Min(note)}
                    className="h-8 gap-1.5 px-2.5 text-xs"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Snooze 5 min
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => void handleDismiss(note)}
                    className="h-8 gap-1.5 bg-[#5B00A3] px-3 text-xs text-white hover:bg-[#4a0086]"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
