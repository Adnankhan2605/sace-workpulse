import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  CheckSquare,
  Plus,
  Trash2,
  Check,
  NotebookPen,
  Bell,
  BellRing,
  ArrowLeftRight,
  X,
  Palette,
  Clock,
  Volume2,
  VolumeX,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createNoteApi,
  deleteNoteApi,
  fetchNotesApi,
  formatReminderLabel,
  notifyNotesChanged,
  subscribeNotesChanged,
  toDatetimeLocalValue,
  updateNoteApi,
  type InkColorId,
  type PaperThemeId,
  type PortalNote,
} from "@/lib/notes-client";
import {
  isGlobalReminderSoundEnabled,
  playTestChime,
  requestDesktopNotificationPermission,
  setGlobalReminderSoundEnabled,
  unlockReminderAudio,
} from "@/lib/reminder-sound";
import { useApp } from "@/lib/store";

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

interface LegacyNotepadPoint {
  id?: string;
  text?: string;
  inkId?: InkColorId;
  reminderAt?: string;
  reminderFired?: boolean;
}

interface LegacyNotepadState {
  paperId?: PaperThemeId;
  activeInkId?: InkColorId;
  points?: LegacyNotepadPoint[];
}

interface NotepadPrefs {
  paperId: PaperThemeId;
  activeInkId: InkColorId;
}

const PAPER_THEMES: Array<{
  id: PaperThemeId;
  label: string;
  swatchClass: string;
  paperClass: string;
  headerBgClass: string;
  borderClass: string;
  marginLineClass: string;
  ruleClass: string;
}> = [
  {
    id: "butter",
    label: "Buttercream",
    swatchClass: "bg-amber-200 border-amber-400",
    paperClass: "bg-[#FEF9C3]",
    headerBgClass: "bg-amber-200/80 border-amber-300/80",
    borderClass: "border-amber-300",
    marginLineClass: "border-rose-400/60",
    ruleClass:
      "bg-[repeating-linear-gradient(to_bottom,transparent_0px,transparent_31px,rgba(217,119,6,0.22)_31px,rgba(217,119,6,0.22)_32px)]",
  },
  {
    id: "lavender",
    label: "Lavender",
    swatchClass: "bg-purple-200 border-purple-400",
    paperClass: "bg-[#F3E8FF]",
    headerBgClass: "bg-purple-200/80 border-purple-300/80",
    borderClass: "border-purple-300",
    marginLineClass: "border-fuchsia-400/60",
    ruleClass:
      "bg-[repeating-linear-gradient(to_bottom,transparent_0px,transparent_31px,rgba(147,51,234,0.18)_31px,rgba(147,51,234,0.18)_32px)]",
  },
  {
    id: "mint",
    label: "Mint Leaf",
    swatchClass: "bg-emerald-200 border-emerald-400",
    paperClass: "bg-[#DCFCE7]",
    headerBgClass: "bg-emerald-200/80 border-emerald-300/80",
    borderClass: "border-emerald-300",
    marginLineClass: "border-teal-500/50",
    ruleClass:
      "bg-[repeating-linear-gradient(to_bottom,transparent_0px,transparent_31px,rgba(5,150,105,0.18)_31px,rgba(5,150,105,0.18)_32px)]",
  },
  {
    id: "peach",
    label: "Peach Cream",
    swatchClass: "bg-orange-200 border-orange-400",
    paperClass: "bg-[#FFEDD5]",
    headerBgClass: "bg-orange-200/80 border-orange-300/80",
    borderClass: "border-orange-300",
    marginLineClass: "border-rose-500/50",
    ruleClass:
      "bg-[repeating-linear-gradient(to_bottom,transparent_0px,transparent_31px,rgba(234,88,12,0.18)_31px,rgba(234,88,12,0.18)_32px)]",
  },
  {
    id: "sky",
    label: "Sky Note",
    swatchClass: "bg-sky-200 border-sky-400",
    paperClass: "bg-[#E0F2FE]",
    headerBgClass: "bg-sky-200/80 border-sky-300/80",
    borderClass: "border-sky-300",
    marginLineClass: "border-rose-400/60",
    ruleClass:
      "bg-[repeating-linear-gradient(to_bottom,transparent_0px,transparent_31px,rgba(2,132,199,0.18)_31px,rgba(2,132,199,0.18)_32px)]",
  },
];

const INK_COLORS: Array<{
  id: InkColorId;
  label: string;
  swatchClass: string;
  textClass: string;
  placeholderClass: string;
}> = [
  {
    id: "charcoal",
    label: "Charcoal",
    swatchClass: "bg-slate-900",
    textClass: "text-slate-900",
    placeholderClass: "placeholder:text-slate-500",
  },
  {
    id: "purple",
    label: "Royal Purple",
    swatchClass: "bg-purple-800",
    textClass: "text-purple-900",
    placeholderClass: "placeholder:text-purple-700/60",
  },
  {
    id: "crimson",
    label: "Crimson",
    swatchClass: "bg-rose-700",
    textClass: "text-rose-800",
    placeholderClass: "placeholder:text-rose-700/60",
  },
  {
    id: "cobalt",
    label: "Cobalt Blue",
    swatchClass: "bg-blue-700",
    textClass: "text-blue-800",
    placeholderClass: "placeholder:text-blue-700/60",
  },
  {
    id: "emerald",
    label: "Forest Green",
    swatchClass: "bg-emerald-700",
    textClass: "text-emerald-800",
    placeholderClass: "placeholder:text-emerald-700/60",
  },
  {
    id: "amber",
    label: "Burnt Orange",
    swatchClass: "bg-orange-700",
    textClass: "text-orange-800",
    placeholderClass: "placeholder:text-orange-700/60",
  },
  {
    id: "magenta",
    label: "Magenta",
    swatchClass: "bg-fuchsia-700",
    textClass: "text-fuchsia-800",
    placeholderClass: "placeholder:text-fuchsia-700/60",
  },
];

const SPIRAL_RINGS = Array.from({ length: 12 }, (_, idx) => idx);

function getInkMeta(inkId: InkColorId) {
  return INK_COLORS.find((c) => c.id === inkId) ?? INK_COLORS[0]!;
}

function getPaperMeta(paperId: PaperThemeId) {
  return PAPER_THEMES.find((p) => p.id === paperId) ?? PAPER_THEMES[0]!;
}

function isValidPaperId(val: unknown): val is PaperThemeId {
  return PAPER_THEMES.some((p) => p.id === val);
}

function isValidInkId(val: unknown): val is InkColorId {
  return INK_COLORS.some((c) => c.id === val);
}

export default function PersonalTodoCard() {
  const { me, canEditModule } = useApp();
  const canEditDashboard = canEditModule("dashboard");
  const userId = me?.id ?? null;

  const [mode, setMode] = useState<"todo" | "notepad">("todo");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [inputText, setInputText] = useState("");

  // Notepad PostgreSQL-backed state
  const [notes, setNotes] = useState<PortalNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [prefs, setPrefs] = useState<NotepadPrefs>({
    paperId: "butter",
    activeInkId: "purple",
  });

  // Composer inputs
  const [noteTitleInput, setNoteTitleInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [showComposerReminder, setShowComposerReminder] = useState(false);
  const [composerReminderAt, setComposerReminderAt] = useState("");

  // Inline reminder editor for existing notes
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [reminderDraft, setReminderDraft] = useState("");
  const [soundAlertOn, setSoundAlertOn] = useState(true);
  const [testingSound, setTestingSound] = useState(false);

  // Swipe gesture state
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const [swipeHint, setSwipeHint] = useState<"left" | "right" | null>(null);

  const todoStorageKey = userId ? `sace_todos_${userId}` : null;
  const legacyNotepadStorageKey = userId ? `sace_notepad_${userId}` : null;
  const notepadPrefsKey = userId ? `sace_notepad_prefs_${userId}` : null;
  const notepadMigratedKey = userId ? `sace_notepad_migrated_${userId}` : null;

  // Load Personal To-Do List
  useEffect(() => {
    if (!todoStorageKey) {
      setTodos([]);
      return;
    }
    try {
      const saved = localStorage.getItem(todoStorageKey);
      if (saved) {
        setTodos(JSON.parse(saved));
      } else {
        const initial: TodoItem[] = [
          {
            id: "1",
            text: "Review daily schedule & team sync",
            completed: false,
            createdAt: new Date().toISOString(),
          },
          {
            id: "2",
            text: "Submit end-of-day report & proofs",
            completed: false,
            createdAt: new Date().toISOString(),
          },
        ];
        setTodos(initial);
        localStorage.setItem(todoStorageKey, JSON.stringify(initial));
      }
    } catch {
      setTodos([]);
    }
  }, [todoStorageKey]);

  // Load visual preferences (paper theme & ink) + global sound toggle
  useEffect(() => {
    if (!userId || !notepadPrefsKey) {
      setPrefs({ paperId: "butter", activeInkId: "purple" });
      setSoundAlertOn(true);
      return;
    }

    setSoundAlertOn(isGlobalReminderSoundEnabled(userId));

    try {
      const savedPrefs = localStorage.getItem(notepadPrefsKey);
      if (savedPrefs) {
        const parsed = JSON.parse(savedPrefs) as Partial<NotepadPrefs>;
        setPrefs({
          paperId: isValidPaperId(parsed.paperId) ? parsed.paperId : "butter",
          activeInkId: isValidInkId(parsed.activeInkId) ? parsed.activeInkId : "purple",
        });
        return;
      }

      if (legacyNotepadStorageKey) {
        const legacyRaw = localStorage.getItem(legacyNotepadStorageKey);
        if (legacyRaw) {
          const legacyParsed = JSON.parse(legacyRaw) as LegacyNotepadState;
          const nextPrefs: NotepadPrefs = {
            paperId: isValidPaperId(legacyParsed.paperId) ? legacyParsed.paperId : "butter",
            activeInkId: isValidInkId(legacyParsed.activeInkId)
              ? legacyParsed.activeInkId
              : "purple",
          };
          setPrefs(nextPrefs);
          localStorage.setItem(notepadPrefsKey, JSON.stringify(nextPrefs));
          return;
        }
      }
    } catch {
      // Fallback to defaults
    }

    setPrefs({ paperId: "butter", activeInkId: "purple" });
  }, [userId, notepadPrefsKey, legacyNotepadStorageKey]);

  // Sync global sound preference changes across tabs/components
  useEffect(() => {
    if (!userId) return;
    const onPrefChange = () => {
      setSoundAlertOn(isGlobalReminderSoundEnabled(userId));
    };
    window.addEventListener("sace:reminder-sound-pref", onPrefChange);
    return () => window.removeEventListener("sace:reminder-sound-pref", onPrefChange);
  }, [userId]);

  const updatePrefs = (next: NotepadPrefs) => {
    setPrefs(next);
    if (!notepadPrefsKey) return;
    try {
      localStorage.setItem(notepadPrefsKey, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  };

  // Load notes from PostgreSQL (+ one-time safe migration from legacy localStorage)
  const loadNotes = useCallback(async () => {
    if (!userId) {
      setNotes([]);
      return;
    }
    setNotesLoading(true);
    try {
      let fetched = await fetchNotesApi();

      if (
        fetched.length === 0 &&
        canEditDashboard &&
        legacyNotepadStorageKey &&
        notepadMigratedKey &&
        localStorage.getItem(notepadMigratedKey) !== "1"
      ) {
        try {
          const legacyRaw = localStorage.getItem(legacyNotepadStorageKey);
          if (legacyRaw) {
            const parsed = JSON.parse(legacyRaw) as LegacyNotepadState;
            const legacyPoints = Array.isArray(parsed.points) ? parsed.points : [];
            const paperId: PaperThemeId = isValidPaperId(parsed.paperId)
              ? parsed.paperId
              : "butter";
            const created: PortalNote[] = [];

            for (const pt of legacyPoints) {
              const content = (pt.text ?? "").trim();
              if (!content) continue;
              let reminderIso: string | null = null;
              if (pt.reminderAt) {
                const parsedDate = new Date(pt.reminderAt);
                if (!Number.isNaN(parsedDate.getTime())) {
                  reminderIso = parsedDate.toISOString();
                }
              }
              const note = await createNoteApi({
                title: "",
                content,
                inkId: isValidInkId(pt.inkId) ? pt.inkId : "purple",
                paperId,
                soundEnabled: true,
                reminderAt: reminderIso,
              });
              created.push(note);
            }

            if (created.length > 0) {
              fetched = created;
              notifyNotesChanged(fetched);
            }
          }
          localStorage.setItem(notepadMigratedKey, "1");
        } catch {
          // Non-fatal migration fallback
        }
      }

      setNotes(fetched);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load notepad notes.");
    } finally {
      setNotesLoading(false);
    }
  }, [userId, canEditDashboard, legacyNotepadStorageKey, notepadMigratedKey]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  // Listen to updates triggered by ReminderWatcher (Snooze / Dismiss / Triggered)
  useEffect(() => {
    const unsubscribe = subscribeNotesChanged((updated) => {
      if (updated) {
        setNotes(updated);
      } else {
        void loadNotes();
      }
    });
    return unsubscribe;
  }, [loadNotes]);

  const saveTodos = (updated: TodoItem[]) => {
    setTodos(updated);
    if (!todoStorageKey) return;
    try {
      localStorage.setItem(todoStorageKey, JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
  };

  // Todo handlers
  const handleAddTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!me || !inputText.trim()) return;
    const newItem: TodoItem = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
      text: inputText.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
    };
    saveTodos([newItem, ...todos]);
    setInputText("");
  };

  const toggleTodo = (id: string) => {
    saveTodos(todos.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
  };

  const deleteTodo = (id: string) => {
    saveTodos(todos.filter((t) => t.id !== id));
  };

  // Sound controls
  const handleToggleGlobalSound = () => {
    void unlockReminderAudio();
    const next = !soundAlertOn;
    setSoundAlertOn(next);
    setGlobalReminderSoundEnabled(next, userId);
    toast.success(next ? "Reminder sound alerts enabled." : "Reminder sound alerts muted.");
  };

  const handleTestSound = async () => {
    setTestingSound(true);
    try {
      const res = await playTestChime();
      await requestDesktopNotificationPermission();
      if (res.ok) {
        toast.success("Notification chime played & browser audio unlocked!");
      } else {
        toast.error(res.error || "Could not play sound preview.");
      }
    } finally {
      setTestingSound(false);
    }
  };

  // Notepad DB handlers
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!me || !canEditDashboard) return;
    const trimmedContent = noteInput.trim();
    if (!trimmedContent) return;

    let reminderIso: string | null = null;
    if (showComposerReminder && composerReminderAt) {
      const parsedMs = new Date(composerReminderAt).getTime();
      if (Number.isNaN(parsedMs)) {
        toast.error("Please pick a valid reminder date and time.");
        return;
      }
      reminderIso = new Date(parsedMs).toISOString();
    }

    void unlockReminderAudio();
    if (reminderIso) {
      void requestDesktopNotificationPermission();
    }

    setNotesSaving(true);
    try {
      const created = await createNoteApi({
        title: noteTitleInput.trim(),
        content: trimmedContent,
        inkId: prefs.activeInkId,
        paperId: prefs.paperId,
        soundEnabled: soundAlertOn,
        reminderAt: reminderIso,
      });
      const next = [...notes, created];
      setNotes(next);
      notifyNotesChanged(next);
      setNoteTitleInput("");
      setNoteInput("");
      setShowComposerReminder(false);
      setComposerReminderAt("");
      if (reminderIso) {
        toast.success(`Note saved with reminder for ${formatReminderLabel(reminderIso)}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save note.");
    } finally {
      setNotesSaving(false);
    }
  };

  const handleDeleteNote = async (id: string) => {
    if (!canEditDashboard) return;
    if (editingReminderId === id) {
      setEditingReminderId(null);
      setReminderDraft("");
    }
    const prev = notes;
    const optimistic = notes.filter((n) => n.id !== id);
    setNotes(optimistic);
    notifyNotesChanged(optimistic);

    try {
      await deleteNoteApi(id);
    } catch (err) {
      setNotes(prev);
      notifyNotesChanged(prev);
      toast.error(err instanceof Error ? err.message : "Could not delete note.");
    }
  };

  const handleOpenReminderEditor = (note: PortalNote) => {
    if (editingReminderId === note.id) {
      setEditingReminderId(null);
      setReminderDraft("");
      return;
    }
    setEditingReminderId(note.id);
    setReminderDraft(toDatetimeLocalValue(note.reminderAt));
  };

  const handleSaveReminder = async (id: string) => {
    if (!canEditDashboard) return;
    if (!reminderDraft) {
      toast.error("Please pick a reminder date and time.");
      return;
    }
    const targetMs = new Date(reminderDraft).getTime();
    if (Number.isNaN(targetMs)) {
      toast.error("Invalid date or time.");
      return;
    }

    void unlockReminderAudio();
    void requestDesktopNotificationPermission();

    const reminderIso = new Date(targetMs).toISOString();
    setNotesSaving(true);
    try {
      const updated = await updateNoteApi(id, {
        reminderAt: reminderIso,
        reminderTriggered: false,
        reminderDismissed: false,
      });
      const next = notes.map((n) => (n.id === id ? updated : n));
      setNotes(next);
      notifyNotesChanged(next);
      setEditingReminderId(null);
      setReminderDraft("");
      toast.success(`Reminder set for ${formatReminderLabel(reminderIso)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save reminder.");
    } finally {
      setNotesSaving(false);
    }
  };

  const handleToggleNoteSound = async (note: PortalNote) => {
    if (!canEditDashboard) return;
    void unlockReminderAudio();
    const nextSound = !note.soundEnabled;
    try {
      const updated = await updateNoteApi(note.id, { soundEnabled: nextSound });
      const next = notes.map((n) => (n.id === note.id ? updated : n));
      setNotes(next);
      notifyNotesChanged(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update note sound setting.");
    }
  };

  const handleClearReminder = async (id: string) => {
    if (!canEditDashboard) return;
    setNotesSaving(true);
    try {
      const updated = await updateNoteApi(id, {
        reminderAt: null,
        reminderTriggered: false,
        reminderDismissed: false,
      });
      const next = notes.map((n) => (n.id === id ? updated : n));
      setNotes(next);
      notifyNotesChanged(next);
      setEditingReminderId(null);
      setReminderDraft("");
      toast.success("Reminder cleared.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not clear reminder.");
    } finally {
      setNotesSaving(false);
    }
  };

  // Swipe handlers (touch + mouse drag on non-interactive card surface)
  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("input, textarea, button, select, label, a"));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(e.target)) {
      pointerStartRef.current = null;
      return;
    }
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerStartRef.current) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    if (Math.abs(dx) > 22 && Math.abs(dx) > Math.abs(dy)) {
      setSwipeHint(dx < 0 ? "left" : "right");
    } else {
      setSwipeHint(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerStartRef.current) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    pointerStartRef.current = null;
    setSwipeHint(null);

    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.1) {
      if (dx < 0 && mode === "todo") {
        setMode("notepad");
      } else if (dx > 0 && mode === "notepad") {
        setMode("todo");
      } else {
        setMode((prev) => (prev === "todo" ? "notepad" : "todo"));
      }
    }
  };

  const handlePointerCancel = () => {
    pointerStartRef.current = null;
    setSwipeHint(null);
  };

  if (!me) return null;

  const remainingCount = todos.filter((t) => !t.completed).length;
  const activePaper = getPaperMeta(prefs.paperId);
  const activeInk = getInkMeta(prefs.activeInkId);
  const upcomingRemindersCount = notes.filter((n) => n.reminderAt && !n.reminderDismissed).length;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className={`relative h-full select-none touch-pan-y transition-transform duration-150 ${
        swipeHint === "left" ? "-translate-x-1.5" : swipeHint === "right" ? "translate-x-1.5" : ""
      }`}
    >
      {mode === "todo" ? (
        <Card className="rounded-2xl border bg-card shadow-xs flex flex-col justify-between h-full">
          <CardHeader className="pb-3 pt-5 px-5 flex flex-row items-center justify-between gap-2 border-b border-border/60">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
                <CheckSquare className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-sm font-bold truncate">Personal To-Do List</CardTitle>
                <p className="text-[11px] text-muted-foreground truncate">
                  Private checklist · swipe for Notepad
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">
                {remainingCount} left
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMode("notepad")}
                className="h-7 px-2.5 text-[11px] gap-1.5 rounded-lg border-primary/30 text-primary hover:bg-primary/10"
                title="Swipe card or click to open Colorful Notepad"
              >
                <NotebookPen className="h-3.5 w-3.5" />
                Notepad
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-5 flex flex-col justify-between flex-1 space-y-4">
            <div className="space-y-4">
              {canEditDashboard && (
                <form onSubmit={handleAddTodo} className="flex gap-2">
                  <Input
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Add a new personal task..."
                    className="text-xs h-9 flex-1"
                    maxLength={120}
                  />
                  <Button type="submit" size="sm" className="h-9 px-3 text-xs gap-1 shrink-0">
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </form>
              )}

              <div className="space-y-2 max-h-[156px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20">
                {todos.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No personal tasks yet.
                  </p>
                ) : (
                  todos.map((item) => (
                    <div
                      key={item.id}
                      className="group flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-muted/30 px-3 py-2 text-xs transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <button
                          type="button"
                          disabled={!canEditDashboard}
                          onClick={() => toggleTodo(item.id)}
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                            item.completed
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-muted-foreground/40 bg-background hover:border-primary"
                          } ${!canEditDashboard ? "opacity-70 cursor-not-allowed" : ""}`}
                        >
                          {item.completed && <Check className="h-3 w-3 stroke-[3]" />}
                        </button>
                        <span
                          className={`truncate font-medium select-text ${
                            item.completed
                              ? "line-through text-muted-foreground"
                              : "text-foreground"
                          }`}
                        >
                          {item.text}
                        </span>
                      </div>
                      {canEditDashboard && (
                        <button
                          type="button"
                          onClick={() => deleteTodo(item.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0 p-1"
                          title="Delete task"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              <button
                type="button"
                onClick={() => setMode("notepad")}
                className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <ArrowLeftRight className="h-3 w-3" />
                <span>Swipe card to open Colorful Notepad</span>
              </button>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-4 rounded-full bg-primary" />
                <button
                  type="button"
                  aria-label="Switch to Colorful Notepad"
                  onClick={() => setMode("notepad")}
                  className="h-1.5 w-1.5 rounded-full bg-muted-foreground/35 hover:bg-primary/60 transition-colors"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div
          className={`rounded-2xl border-2 ${activePaper.borderClass} ${activePaper.paperClass} shadow-sm flex flex-col justify-between h-full overflow-hidden text-slate-900`}
        >
          {/* Realistic Spiral Wire Binding */}
          <div
            className={`px-4 pt-2 pb-1.5 border-b ${activePaper.headerBgClass} flex flex-col gap-2`}
          >
            <div className="flex items-center justify-between px-1" aria-hidden="true">
              {SPIRAL_RINGS.map((ring) => (
                <div key={ring} className="flex flex-col items-center">
                  <span className="h-2.5 w-1.5 rounded-full bg-slate-700/80 shadow-xs" />
                  <span className="-mt-1 h-2 w-2 rounded-full bg-white/90 border border-slate-400/80" />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 rounded-lg bg-slate-900/10 text-slate-900 shrink-0">
                  <NotebookPen className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">
                    Personal Notepad
                  </h3>
                  <p className="text-[11px] text-slate-700 truncate">
                    {notes.length} note{notes.length === 1 ? "" : "s"}
                    {upcomingRemindersCount > 0
                      ? ` · ${upcomingRemindersCount} active reminder${upcomingRemindersCount === 1 ? "" : "s"}`
                      : " · synced to portal"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleGlobalSound}
                  title={soundAlertOn ? "Mute reminder chimes" : "Enable reminder chimes"}
                  className={`h-7 px-2 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ${
                    soundAlertOn
                      ? "bg-white/85 border-[#5B00A3]/35 text-[#5B00A3] hover:bg-white"
                      : "bg-white/60 border-slate-400/60 text-slate-600 hover:bg-white"
                  }`}
                >
                  {soundAlertOn ? (
                    <Volume2 className="h-3.5 w-3.5" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5" />
                  )}
                  <span>{soundAlertOn ? "Sound ON" : "Sound OFF"}</span>
                </button>

                <button
                  type="button"
                  disabled={testingSound}
                  onClick={() => void handleTestSound()}
                  title="Play chime preview & unlock browser audio alerts"
                  className="h-7 px-2 rounded-lg border border-slate-400/60 bg-white/85 hover:bg-white text-slate-900 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors disabled:opacity-60"
                >
                  <Volume2 className="h-3.5 w-3.5 text-[#5B00A3]" />
                  <span>Test Sound</span>
                </button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMode("todo")}
                  className="h-7 px-2.5 text-[11px] gap-1.5 rounded-lg bg-white/80 hover:bg-white text-slate-900 border-slate-400/60"
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  To-Do
                </Button>
              </div>
            </div>

            {/* Paper Color + Text Ink Color Bar */}
            {canEditDashboard && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-900/10">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1">
                    <Palette className="h-3 w-3" /> Ink
                  </span>
                  <div className="flex items-center gap-1">
                    {INK_COLORS.map((ink) => {
                      const selected = prefs.activeInkId === ink.id;
                      return (
                        <button
                          key={ink.id}
                          type="button"
                          onClick={() => updatePrefs({ ...prefs, activeInkId: ink.id })}
                          title={`Text color: ${ink.label}`}
                          aria-label={`Select ${ink.label} text color`}
                          className={`h-4 w-4 rounded-full ${ink.swatchClass} transition-transform ${
                            selected
                              ? "ring-2 ring-offset-1 ring-slate-900 scale-110"
                              : "opacity-75 hover:opacity-100"
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 mr-0.5">
                    Page
                  </span>
                  {PAPER_THEMES.map((paper) => {
                    const selected = prefs.paperId === paper.id;
                    return (
                      <button
                        key={paper.id}
                        type="button"
                        onClick={() => updatePrefs({ ...prefs, paperId: paper.id })}
                        title={`Page theme: ${paper.label}`}
                        aria-label={`Select ${paper.label} notepad color`}
                        className={`h-4 w-4 rounded-sm border ${paper.swatchClass} transition-transform ${
                          selected
                            ? "ring-2 ring-offset-1 ring-slate-900 scale-110"
                            : "opacity-80 hover:opacity-100"
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Ruled Paper Area */}
          <div className={`relative flex-1 flex flex-col justify-between ${activePaper.ruleClass}`}>
            {/* Vertical Margin Line */}
            <div
              className={`pointer-events-none absolute top-0 bottom-0 left-9 border-l-2 ${activePaper.marginLineClass}`}
              aria-hidden="true"
            />

            <div className="relative z-10 flex flex-col flex-1 px-3 py-2.5 pl-11 space-y-2">
              {/* Quick Add Note Form with Optional Title + Reminder Picker */}
              {canEditDashboard && (
                <form onSubmit={(e) => void handleAddNote(e)} className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs font-bold tabular-nums shrink-0 ${activeInk.textClass}`}
                    >
                      {notes.length + 1}.
                    </span>
                    <input
                      type="text"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder={`Write note in ${activeInk.label.toLowerCase()}...`}
                      maxLength={300}
                      className={`flex-1 bg-white/70 border border-slate-900/15 rounded-lg px-2.5 h-8 text-xs font-medium outline-none focus:bg-white/95 focus:border-slate-900/40 ${activeInk.textClass} ${activeInk.placeholderClass}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void unlockReminderAudio();
                        setShowComposerReminder((prev) => {
                          const next = !prev;
                          if (next && !composerReminderAt) {
                            setComposerReminderAt(toDatetimeLocalValue());
                          }
                          return next;
                        });
                      }}
                      title="Set reminder date & time for this note"
                      className={`h-8 px-2 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 transition-colors ${
                        showComposerReminder
                          ? "bg-[#5B00A3] text-white border-[#5B00A3]"
                          : "bg-white/75 text-slate-800 border-slate-900/15 hover:bg-white"
                      }`}
                    >
                      <Bell className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Remind</span>
                    </button>
                    <button
                      type="submit"
                      disabled={notesSaving}
                      className="h-8 px-2.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-1 shrink-0 transition-colors disabled:opacity-60"
                    >
                      {notesSaving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Add
                    </button>
                  </div>

                  {showComposerReminder && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-white/80 border border-slate-900/15 px-2.5 py-1.5">
                      <input
                        type="text"
                        value={noteTitleInput}
                        onChange={(e) => setNoteTitleInput(e.target.value)}
                        placeholder="Short title (optional)"
                        maxLength={80}
                        className="h-7 flex-1 min-w-[120px] rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-[#5B00A3]"
                      />
                      <div className="flex items-center gap-1.5 flex-1 min-w-[175px]">
                        <Clock className="h-3 w-3 text-[#5B00A3] shrink-0" />
                        <input
                          type="datetime-local"
                          value={composerReminderAt}
                          onChange={(e) => setComposerReminderAt(e.target.value)}
                          aria-label="Reminder date and time"
                          className="h-7 flex-1 rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-[#5B00A3]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowComposerReminder(false);
                          setComposerReminderAt("");
                          setNoteTitleInput("");
                        }}
                        aria-label="Cancel reminder fields"
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-900/10"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </form>
              )}

              {/* Numbered Points List */}
              <div className="space-y-1.5 max-h-[165px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-900/20">
                {notesLoading && notes.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-5 text-xs text-slate-700">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading notes...</span>
                  </div>
                ) : notes.length === 0 ? (
                  <p className="text-xs italic text-slate-600 py-4 text-center">
                    Start writing numbered notes above — set date/time reminders with audible chimes
                    across all portal pages!
                  </p>
                ) : (
                  notes.map((note, idx) => {
                    const ptInk = getInkMeta(note.inkId);
                    const isEditingReminder = editingReminderId === note.id;
                    const dueMs = note.reminderAt ? new Date(note.reminderAt).getTime() : NaN;
                    const isDue =
                      Boolean(note.reminderAt) &&
                      !note.reminderDismissed &&
                      !Number.isNaN(dueMs) &&
                      dueMs <= Date.now();

                    return (
                      <div
                        key={note.id}
                        className="group rounded-lg bg-white/55 hover:bg-white/85 border border-slate-900/10 px-2.5 py-1.5 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            <span
                              className={`text-xs font-extrabold tabular-nums shrink-0 mt-0.5 ${ptInk.textClass}`}
                            >
                              {idx + 1}.
                            </span>
                            <div className="min-w-0 flex-1">
                              {note.title.trim() && (
                                <p className="text-[11px] font-bold text-slate-900 truncate select-text">
                                  {note.title}
                                </p>
                              )}
                              <p
                                className={`text-xs font-semibold leading-snug break-words select-text ${ptInk.textClass}`}
                              >
                                {note.content}
                              </p>
                              {note.reminderAt && (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                                      note.reminderDismissed
                                        ? "bg-emerald-700/15 text-emerald-900"
                                        : isDue
                                          ? "bg-rose-600 text-white"
                                          : "bg-[#5B00A3]/10 text-[#5B00A3]"
                                    }`}
                                  >
                                    <Clock className="h-2.5 w-2.5" />
                                    {note.reminderDismissed
                                      ? "Dismissed · "
                                      : isDue
                                        ? "Due · "
                                        : "Reminder · "}
                                    {formatReminderLabel(note.reminderAt)}
                                  </span>
                                  {!note.soundEnabled && (
                                    <span className="inline-flex items-center gap-0.5 rounded-md bg-slate-900/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                      <VolumeX className="h-2.5 w-2.5" /> Muted
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {canEditDashboard && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => void handleToggleNoteSound(note)}
                                title={
                                  note.soundEnabled
                                    ? "Sound alert ON for this note (click to mute)"
                                    : "Sound alert OFF for this note (click to enable)"
                                }
                                className={`p-1 rounded-md transition-colors ${
                                  note.soundEnabled
                                    ? "text-[#5B00A3] hover:bg-[#5B00A3]/10"
                                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-900/10"
                                }`}
                              >
                                {note.soundEnabled ? (
                                  <Volume2 className="h-3.5 w-3.5" />
                                ) : (
                                  <VolumeX className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenReminderEditor(note)}
                                title={
                                  note.reminderAt ? "Edit reminder" : "Set date & time reminder"
                                }
                                className={`p-1 rounded-md transition-colors ${
                                  note.reminderAt && !note.reminderDismissed
                                    ? "text-amber-700 bg-amber-500/15 hover:bg-amber-500/25"
                                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-900/10"
                                }`}
                              >
                                {note.reminderAt && !note.reminderDismissed ? (
                                  <BellRing className="h-3.5 w-3.5" />
                                ) : (
                                  <Bell className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteNote(note.id)}
                                title="Delete note"
                                className="p-1 rounded-md text-slate-500 hover:text-rose-700 hover:bg-rose-500/10 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {isEditingReminder && (
                          <div className="mt-2 pt-2 border-t border-slate-900/10 flex flex-wrap items-center gap-1.5">
                            <input
                              type="datetime-local"
                              value={reminderDraft}
                              onChange={(e) => setReminderDraft(e.target.value)}
                              className="h-7 rounded-md border border-slate-400/70 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-[#5B00A3] flex-1 min-w-[165px]"
                            />
                            <button
                              type="button"
                              disabled={notesSaving}
                              onClick={() => void handleSaveReminder(note.id)}
                              className="h-7 px-2.5 rounded-md bg-[#5B00A3] text-white text-[11px] font-semibold hover:bg-[#4a0086] disabled:opacity-60"
                            >
                              Set
                            </button>
                            {note.reminderAt && (
                              <button
                                type="button"
                                disabled={notesSaving}
                                onClick={() => void handleClearReminder(note.id)}
                                className="h-7 px-2 rounded-md border border-rose-300 bg-rose-50 text-rose-700 text-[11px] font-semibold hover:bg-rose-100 disabled:opacity-60"
                              >
                                Clear
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingReminderId(null);
                                setReminderDraft("");
                              }}
                              aria-label="Close reminder picker"
                              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-600 hover:bg-slate-900/10"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Footer Swipe Indicator */}
            <div className="relative z-10 flex items-center justify-between px-4 py-2 pl-11 border-t border-slate-900/10 bg-white/35 text-[11px] text-slate-700">
              <button
                type="button"
                onClick={() => setMode("todo")}
                className="inline-flex items-center gap-1.5 hover:text-slate-950 font-medium transition-colors"
              >
                <ArrowLeftRight className="h-3 w-3" />
                <span>Swipe back to To-Do List</span>
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Switch to Personal To-Do List"
                  onClick={() => setMode("todo")}
                  className="h-1.5 w-1.5 rounded-full bg-slate-900/30 hover:bg-slate-900/60 transition-colors"
                />
                <span className="h-1.5 w-4 rounded-full bg-slate-900" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
