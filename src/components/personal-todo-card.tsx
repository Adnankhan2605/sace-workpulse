import React, { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApp } from "@/lib/store";

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

type PaperThemeId = "butter" | "lavender" | "mint" | "peach" | "sky";
type InkColorId = "charcoal" | "purple" | "crimson" | "cobalt" | "emerald" | "amber" | "magenta";

interface NotepadPoint {
  id: string;
  text: string;
  inkId: InkColorId;
  reminderAt?: string; // ISO or datetime-local string
  reminderFired?: boolean;
  createdAt: string;
}

interface NotepadState {
  paperId: PaperThemeId;
  activeInkId: InkColorId;
  points: NotepadPoint[];
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

function formatReminderLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDatetimeLocalDefault(): string {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PersonalTodoCard() {
  const { me } = useApp();
  const [mode, setMode] = useState<"todo" | "notepad">("todo");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [inputText, setInputText] = useState("");

  const [notepad, setNotepad] = useState<NotepadState>({
    paperId: "butter",
    activeInkId: "purple",
    points: [],
  });
  const [noteInput, setNoteInput] = useState("");
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [reminderDraft, setReminderDraft] = useState("");

  // Swipe gesture state
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const [swipeHint, setSwipeHint] = useState<"left" | "right" | null>(null);

  const todoStorageKey = me ? `sace_todos_${me.id}` : null;
  const notepadStorageKey = me ? `sace_notepad_${me.id}` : null;

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

  // Load Colorful Notepad
  useEffect(() => {
    if (!notepadStorageKey) {
      setNotepad({ paperId: "butter", activeInkId: "purple", points: [] });
      return;
    }
    try {
      const saved = localStorage.getItem(notepadStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<NotepadState>;
        setNotepad({
          paperId: parsed.paperId ?? "butter",
          activeInkId: parsed.activeInkId ?? "purple",
          points: Array.isArray(parsed.points) ? parsed.points : [],
        });
      } else {
        const initial: NotepadState = {
          paperId: "butter",
          activeInkId: "purple",
          points: [
            {
              id: "note-1",
              text: "Follow up on priority client deliverables",
              inkId: "purple",
              createdAt: new Date().toISOString(),
            },
            {
              id: "note-2",
              text: "Share sprint notes with the squad before EOD",
              inkId: "cobalt",
              createdAt: new Date().toISOString(),
            },
          ],
        };
        setNotepad(initial);
        localStorage.setItem(notepadStorageKey, JSON.stringify(initial));
      }
    } catch {
      setNotepad({ paperId: "butter", activeInkId: "purple", points: [] });
    }
  }, [notepadStorageKey]);

  const saveTodos = (updated: TodoItem[]) => {
    setTodos(updated);
    if (!todoStorageKey) return;
    try {
      localStorage.setItem(todoStorageKey, JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
  };

  const saveNotepad = (updated: NotepadState) => {
    setNotepad(updated);
    if (!notepadStorageKey) return;
    try {
      localStorage.setItem(notepadStorageKey, JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
  };

  // Poll reminders every 10 seconds so due reminders fire live
  useEffect(() => {
    if (!notepadStorageKey) return;

    const checkDueReminders = () => {
      const nowMs = Date.now();
      let changed = false;
      const firedItems: Array<{ index: number; text: string }> = [];

      setNotepad((prev) => {
        const nextPoints = prev.points.map((pt, idx) => {
          if (!pt.reminderAt || pt.reminderFired) return pt;
          const dueMs = new Date(pt.reminderAt).getTime();
          if (!Number.isNaN(dueMs) && dueMs <= nowMs) {
            changed = true;
            firedItems.push({ index: idx + 1, text: pt.text });
            return { ...pt, reminderFired: true };
          }
          return pt;
        });

        if (!changed) return prev;
        const updated = { ...prev, points: nextPoints };
        try {
          localStorage.setItem(notepadStorageKey, JSON.stringify(updated));
        } catch (e) {
          console.error(e);
        }
        return updated;
      });

      firedItems.forEach((item) => {
        toast.info(`Notepad Reminder #${item.index}`, {
          description: item.text,
          duration: 8000,
        });
      });
    };

    checkDueReminders();
    const timer = window.setInterval(checkDueReminders, 10_000);
    return () => window.clearInterval(timer);
  }, [notepadStorageKey]);

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

  // Notepad handlers
  const handleAddPoint = (e: React.FormEvent) => {
    e.preventDefault();
    if (!me || !noteInput.trim()) return;
    const newPoint: NotepadPoint = {
      id: globalThis.crypto?.randomUUID?.() ?? `pt-${Date.now()}`,
      text: noteInput.trim(),
      inkId: notepad.activeInkId,
      createdAt: new Date().toISOString(),
    };
    saveNotepad({
      ...notepad,
      points: [...notepad.points, newPoint],
    });
    setNoteInput("");
  };

  const handleDeletePoint = (id: string) => {
    if (editingReminderId === id) {
      setEditingReminderId(null);
      setReminderDraft("");
    }
    saveNotepad({
      ...notepad,
      points: notepad.points.filter((p) => p.id !== id),
    });
  };

  const handleOpenReminderEditor = (pt: NotepadPoint) => {
    if (editingReminderId === pt.id) {
      setEditingReminderId(null);
      setReminderDraft("");
      return;
    }
    setEditingReminderId(pt.id);
    setReminderDraft(pt.reminderAt || toDatetimeLocalDefault());
  };

  const handleSaveReminder = (id: string) => {
    if (!reminderDraft) {
      toast.error("Please pick a reminder date and time.");
      return;
    }
    const targetMs = new Date(reminderDraft).getTime();
    if (Number.isNaN(targetMs)) {
      toast.error("Invalid date or time.");
      return;
    }
    saveNotepad({
      ...notepad,
      points: notepad.points.map((pt) =>
        pt.id === id
          ? {
              ...pt,
              reminderAt: reminderDraft,
              reminderFired: targetMs <= Date.now(),
            }
          : pt,
      ),
    });
    setEditingReminderId(null);
    setReminderDraft("");
    toast.success(`Reminder set for ${formatReminderLabel(reminderDraft)}`);
  };

  const handleClearReminder = (id: string) => {
    saveNotepad({
      ...notepad,
      points: notepad.points.map((pt) => {
        if (pt.id !== id) return pt;
        const { reminderAt: _removed, ...rest } = pt;
        return { ...rest, reminderFired: false };
      }),
    });
    setEditingReminderId(null);
    setReminderDraft("");
    toast.success("Reminder cleared.");
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
        // Also allow swiping either direction to toggle smoothly
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
  const activePaper = getPaperMeta(notepad.paperId);
  const activeInk = getInkMeta(notepad.activeInkId);
  const upcomingRemindersCount = notepad.points.filter(
    (p) => p.reminderAt && !p.reminderFired,
  ).length;

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

              <div className="space-y-2 max-h-[156px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20">
                {todos.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No personal tasks yet. Add one above!
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
                          onClick={() => toggleTodo(item.id)}
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                            item.completed
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-muted-foreground/40 bg-background hover:border-primary"
                          }`}
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
                      <button
                        type="button"
                        onClick={() => deleteTodo(item.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0 p-1"
                        title="Delete task"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
                    {notepad.points.length} note{notepad.points.length === 1 ? "" : "s"}
                    {upcomingRemindersCount > 0
                      ? ` · ${upcomingRemindersCount} reminder${upcomingRemindersCount === 1 ? "" : "s"}`
                      : " · swipe back for To-Do"}
                  </p>
                </div>
              </div>

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

            {/* Paper Color + Text Ink Color Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-900/10">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1">
                  <Palette className="h-3 w-3" /> Ink
                </span>
                <div className="flex items-center gap-1">
                  {INK_COLORS.map((ink) => {
                    const selected = notepad.activeInkId === ink.id;
                    return (
                      <button
                        key={ink.id}
                        type="button"
                        onClick={() => saveNotepad({ ...notepad, activeInkId: ink.id })}
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
                  const selected = notepad.paperId === paper.id;
                  return (
                    <button
                      key={paper.id}
                      type="button"
                      onClick={() => saveNotepad({ ...notepad, paperId: paper.id })}
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
          </div>

          {/* Ruled Paper Area */}
          <div className={`relative flex-1 flex flex-col justify-between ${activePaper.ruleClass}`}>
            {/* Vertical Margin Line */}
            <div
              className={`pointer-events-none absolute top-0 bottom-0 left-9 border-l-2 ${activePaper.marginLineClass}`}
              aria-hidden="true"
            />

            <div className="relative z-10 flex flex-col flex-1 px-3 py-2.5 pl-11 space-y-2">
              {/* Quick Add Point Input in Selected Ink Color */}
              <form onSubmit={handleAddPoint} className="flex items-center gap-1.5">
                <span className={`text-xs font-bold tabular-nums shrink-0 ${activeInk.textClass}`}>
                  {notepad.points.length + 1}.
                </span>
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder={`Write note in ${activeInk.label.toLowerCase()}...`}
                  maxLength={180}
                  className={`flex-1 bg-white/65 border border-slate-900/15 rounded-lg px-2.5 h-8 text-xs font-medium outline-none focus:bg-white/90 focus:border-slate-900/40 ${activeInk.textClass} ${activeInk.placeholderClass}`}
                />
                <button
                  type="submit"
                  className="h-8 px-2.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-1 shrink-0 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </form>

              {/* Numbered Points List */}
              <div className="space-y-1.5 max-h-[155px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-900/20">
                {notepad.points.length === 0 ? (
                  <p className="text-xs italic text-slate-600 py-4 text-center">
                    Start writing numbered notes above — pick any ink color and set date/time
                    reminders!
                  </p>
                ) : (
                  notepad.points.map((pt, idx) => {
                    const ptInk = getInkMeta(pt.inkId);
                    const isEditingReminder = editingReminderId === pt.id;
                    const isDue =
                      pt.reminderAt &&
                      !Number.isNaN(new Date(pt.reminderAt).getTime()) &&
                      new Date(pt.reminderAt).getTime() <= Date.now();

                    return (
                      <div
                        key={pt.id}
                        className="group rounded-lg bg-white/45 hover:bg-white/75 border border-slate-900/10 px-2.5 py-1.5 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            <span
                              className={`text-xs font-extrabold tabular-nums shrink-0 mt-0.5 ${ptInk.textClass}`}
                            >
                              {idx + 1}.
                            </span>
                            <div className="min-w-0 flex-1">
                              <p
                                className={`text-xs font-semibold leading-snug break-words select-text ${ptInk.textClass}`}
                              >
                                {pt.text}
                              </p>
                              {pt.reminderAt && (
                                <span
                                  className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                                    isDue
                                      ? "bg-rose-600 text-white"
                                      : "bg-slate-900/10 text-slate-800"
                                  }`}
                                >
                                  <Clock className="h-2.5 w-2.5" />
                                  {isDue ? "Due · " : ""}
                                  {formatReminderLabel(pt.reminderAt)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenReminderEditor(pt)}
                              title={pt.reminderAt ? "Edit reminder" : "Set date & time reminder"}
                              className={`p-1 rounded-md transition-colors ${
                                pt.reminderAt
                                  ? "text-amber-700 bg-amber-500/15 hover:bg-amber-500/25"
                                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-900/10"
                              }`}
                            >
                              {pt.reminderAt ? (
                                <BellRing className="h-3.5 w-3.5" />
                              ) : (
                                <Bell className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePoint(pt.id)}
                              title="Delete note"
                              className="p-1 rounded-md text-slate-500 hover:text-rose-700 hover:bg-rose-500/10 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {isEditingReminder && (
                          <div className="mt-2 pt-2 border-t border-slate-900/10 flex flex-wrap items-center gap-1.5">
                            <input
                              type="datetime-local"
                              value={reminderDraft}
                              onChange={(e) => setReminderDraft(e.target.value)}
                              className="h-7 rounded-md border border-slate-400/70 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-slate-900 flex-1 min-w-[165px]"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveReminder(pt.id)}
                              className="h-7 px-2.5 rounded-md bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800"
                            >
                              Set
                            </button>
                            {pt.reminderAt && (
                              <button
                                type="button"
                                onClick={() => handleClearReminder(pt.id)}
                                className="h-7 px-2 rounded-md border border-rose-300 bg-rose-50 text-rose-700 text-[11px] font-semibold hover:bg-rose-100"
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
