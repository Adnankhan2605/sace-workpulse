import * as React from "react";
import { toast } from "sonner";
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Play,
  Plus,
  RotateCcw,
} from "lucide-react";
import { EmptyState, Initials } from "@/components/app-shell";
import { StatusPill } from "@/components/portal-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  formatWorkweekRange,
  getWorkweekDays,
  resolveTaskCompletionDateKey,
  toLocalDateKey,
  type WorkweekDay,
} from "@/lib/cadence";
import { titleCase } from "@/lib/format";
import { isoNow, newId, useApp } from "@/lib/store";
import type { Priority, Task, TaskWeeklyAction, User } from "@/lib/types";

interface WeeklyTaskPlannerProps {
  isAdmin: boolean;
  teamMembers: User[];
  onEditTask: (task: Task) => void;
}

type ReviewWeekChoice = "last" | "current";
type PlannerViewMode = "review" | "schedule";
type ScheduleScopeChoice = "both" | "current" | "next";

function getTaskScheduledDate(task: Task): string {
  return (task.plannedDate && task.plannedDate.slice(0, 10)) || task.dueDate;
}

function isDoneStatus(status: Task["status"]): boolean {
  return status === "completed" || status === "approved";
}

function formatWeeklyActionLabel(action: TaskWeeklyAction | null | undefined): string {
  switch (action) {
    case "done":
      return "Marked Done";
    case "resumed":
      return "Resumed";
    case "rework":
      return "Rework Queued";
    default:
      return "Needs Check-in";
  }
}

export function WeeklyTaskPlanner({ isAdmin, teamMembers, onEditTask }: WeeklyTaskPlannerProps) {
  const { state, me, update, log, notify } = useApp();

  const today = React.useMemo(() => new Date(), []);
  const isMonday = today.getDay() === 1;
  const todayKey = React.useMemo(() => toLocalDateKey(today), [today]);

  const lastWeekDays = React.useMemo(() => getWorkweekDays(today, -1), [today]);
  const currentWeekDays = React.useMemo(() => getWorkweekDays(today, 0), [today]);
  const nextWeekDays = React.useMemo(() => getWorkweekDays(today, 1), [today]);

  const [viewMode, setViewMode] = React.useState<PlannerViewMode>("review");
  const [reviewWeek, setReviewWeek] = React.useState<ReviewWeekChoice>(
    isMonday ? "last" : "current",
  );
  const [selectedDayKey, setSelectedDayKey] = React.useState<string>("all");
  const [memberScope, setMemberScope] = React.useState<string>(isAdmin ? "all" : "me");
  const [reviewStatusFilter, setReviewStatusFilter] = React.useState<
    "all" | "pending" | "done" | "reopened"
  >("all");
  const [scheduleScope, setScheduleScope] = React.useState<ScheduleScopeChoice>("both");

  // Inline scheduler/action state for Resume, Rework, or Schedule on any task
  const [activeActionTask, setActiveActionTask] = React.useState<{
    taskId: string;
    mode: "resume" | "rework" | "schedule";
    targetDate: string;
    note: string;
  } | null>(null);

  // Quick-add planned task modal/inline form for Present or Coming week
  const [quickPlanDay, setQuickPlanDay] = React.useState<string | null>(null);
  const [quickPlanTitle, setQuickPlanTitle] = React.useState("");
  const [quickPlanDesc, setQuickPlanDesc] = React.useState("");
  const [quickPlanPriority, setQuickPlanPriority] = React.useState<Priority>("medium");

  const teamIds = React.useMemo(() => new Set(teamMembers.map((u) => u.id)), [teamMembers]);
  const currentUserId = me?.id ?? "";

  const scopedTasks = React.useMemo(() => {
    return state.tasks.filter((t) => {
      if (!isAdmin || memberScope === "me") {
        return t.assigneeId === currentUserId;
      }
      if (memberScope === "all") {
        return teamIds.has(t.assigneeId);
      }
      return t.assigneeId === memberScope;
    });
  }, [state.tasks, isAdmin, memberScope, currentUserId, teamIds]);

  const activeReviewDays = reviewWeek === "last" ? lastWeekDays : currentWeekDays;
  const activeReviewDayMap = React.useMemo(
    () => new Map(activeReviewDays.map((d) => [d.dateKey, d])),
    [activeReviewDays],
  );
  const lastWeekDateSet = React.useMemo(
    () => new Set(lastWeekDays.map((d) => d.dateKey)),
    [lastWeekDays],
  );
  const currentWeekDateSet = React.useMemo(
    () => new Set(currentWeekDays.map((d) => d.dateKey)),
    [currentWeekDays],
  );

  // Tasks completed Mon-Fri (either currently completed/approved, OR already reviewed & resumed/reworked from that week)
  const getCompletedTasksForWeek = React.useCallback(
    (daySet: Set<string>) => {
      return scopedTasks.filter((t) => {
        const compKey = resolveTaskCompletionDateKey(t);
        if (compKey && daySet.has(compKey)) {
          return true;
        }
        // Keep tasks originally completed in that Mon-Fri window visible even right after Resume/Rework
        if (
          (t.weeklyAction === "resumed" || t.weeklyAction === "rework") &&
          t.completedAt &&
          daySet.has(t.completedAt.slice(0, 10))
        ) {
          return true;
        }
        return false;
      });
    },
    [scopedTasks],
  );

  const lastWeekCompletedAll = React.useMemo(
    () => getCompletedTasksForWeek(lastWeekDateSet),
    [getCompletedTasksForWeek, lastWeekDateSet],
  );
  const currentWeekCompletedAll = React.useMemo(
    () => getCompletedTasksForWeek(currentWeekDateSet),
    [getCompletedTasksForWeek, currentWeekDateSet],
  );

  const weekCompletedTasks = reviewWeek === "last" ? lastWeekCompletedAll : currentWeekCompletedAll;

  const getTaskWeekDate = React.useCallback((task: Task): string => {
    const compKey = resolveTaskCompletionDateKey(task);
    if (compKey) return compKey;
    if (task.completedAt && task.completedAt.length >= 10) {
      return task.completedAt.slice(0, 10);
    }
    return task.dueDate;
  }, []);

  const filteredReviewTasks = React.useMemo(() => {
    return weekCompletedTasks
      .filter((t) => {
        const dayKey = getTaskWeekDate(t);
        if (selectedDayKey !== "all" && dayKey !== selectedDayKey) return false;
        if (reviewStatusFilter === "pending" && t.weeklyAction) return false;
        if (reviewStatusFilter === "done" && t.weeklyAction !== "done") return false;
        if (
          reviewStatusFilter === "reopened" &&
          t.weeklyAction !== "resumed" &&
          t.weeklyAction !== "rework"
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => getTaskWeekDate(a).localeCompare(getTaskWeekDate(b)));
  }, [weekCompletedTasks, selectedDayKey, reviewStatusFilter, getTaskWeekDate]);

  // Day counts for Mon-Fri strip
  const dayCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of activeReviewDays) counts.set(d.dateKey, 0);
    for (const t of weekCompletedTasks) {
      const k = getTaskWeekDate(t);
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [activeReviewDays, weekCompletedTasks, getTaskWeekDate]);

  // Summary counters
  const pendingDecisionCount = weekCompletedTasks.filter((t) => !t.weeklyAction).length;
  const markedDoneCount = weekCompletedTasks.filter((t) => t.weeklyAction === "done").length;
  const reopenedCount = weekCompletedTasks.filter(
    (t) => t.weeklyAction === "resumed" || t.weeklyAction === "rework",
  ).length;

  // Present & Coming Week day lookup
  const presentAndComingDays = React.useMemo(
    () => [
      ...currentWeekDays.map((d) => ({ ...d, weekLabel: "This Week" })),
      ...nextWeekDays.map((d) => ({ ...d, weekLabel: "Next Week" })),
    ],
    [currentWeekDays, nextWeekDays],
  );
  const presentAndComingSet = React.useMemo(
    () => new Set(presentAndComingDays.map((d) => d.dateKey)),
    [presentAndComingDays],
  );

  // Tasks NOT currently scheduled inside Present/Coming Mon-Fri that are still open/resumed/rework
  const unscheduledActiveTasks = React.useMemo(() => {
    return scopedTasks.filter(
      (t) => !isDoneStatus(t.status) && !presentAndComingSet.has(getTaskScheduledDate(t)),
    );
  }, [scopedTasks, presentAndComingSet]);

  if (!me) return null;

  const handleMarkDone = (task: Task) => {
    const compDate = resolveTaskCompletionDateKey(task) ?? todayKey;
    update((d) => {
      const t = d.tasks.find((x) => x.id === task.id);
      if (!t) return;
      if (!isDoneStatus(t.status)) {
        t.status = "completed";
      }
      t.completedAt = t.completedAt || compDate;
      t.weeklyAction = "done";
    });
    log("Weekly task marked Done", task.title);
    toast.success(`"${task.title}" marked as Done.`);
    if (activeActionTask?.taskId === task.id) {
      setActiveActionTask(null);
    }
  };

  const openInlineAction = (task: Task, mode: "resume" | "rework" | "schedule") => {
    const defaultTarget =
      (task.plannedDate && presentAndComingSet.has(task.plannedDate)
        ? task.plannedDate
        : undefined) ??
      currentWeekDays.find((d) => d.dateKey >= todayKey)?.dateKey ??
      nextWeekDays[0]?.dateKey ??
      todayKey;

    setActiveActionTask({
      taskId: task.id,
      mode,
      targetDate: defaultTarget,
      note: "",
    });
  };

  const handleConfirmInlineAction = (task: Task) => {
    if (!activeActionTask || activeActionTask.taskId !== task.id) return;
    const { mode, targetDate, note } = activeActionTask;
    if (!targetDate) {
      toast.error("Please select a target day in the present or coming week.");
      return;
    }

    const preservedCompletedAt = task.completedAt || resolveTaskCompletionDateKey(task) || todayKey;

    update((d) => {
      const t = d.tasks.find((x) => x.id === task.id);
      if (!t) return;
      t.plannedDate = targetDate;
      t.dueDate = targetDate;

      if (mode === "resume") {
        t.completedAt = t.completedAt || preservedCompletedAt;
        t.status = "in_progress";
        t.weeklyAction = "resumed";
        t.comments.push({
          id: newId(),
          authorId: me.id,
          body: `Resumed from weekly review · scheduled for ${targetDate}${note.trim() ? `: ${note.trim()}` : ""}`,
          at: isoNow(),
        });
      } else if (mode === "rework") {
        t.completedAt = t.completedAt || preservedCompletedAt;
        t.status = "revision_requested";
        t.weeklyAction = "rework";
        t.comments.push({
          id: newId(),
          authorId: me.id,
          body: `Queued for rework · scheduled for ${targetDate}${note.trim() ? `: ${note.trim()}` : ""}`,
          at: isoNow(),
        });
      } else {
        t.comments.push({
          id: newId(),
          authorId: me.id,
          body: `Scheduled for ${targetDate}${note.trim() ? `: ${note.trim()}` : ""}`,
          at: isoNow(),
        });
      }
    });

    if (task.assigneeId !== me.id) {
      notify(
        task.assigneeId,
        mode === "rework"
          ? "Task Sent for Rework"
          : mode === "resume"
            ? "Task Resumed"
            : "Task Rescheduled",
        `${me.fullName} updated "${task.title}" for ${targetDate}.`,
        "/tasks",
      );
    }

    log(
      mode === "resume"
        ? "Task resumed"
        : mode === "rework"
          ? "Task marked for rework"
          : "Task scheduled",
      `${task.title} → ${targetDate}`,
    );
    toast.success(
      mode === "resume"
        ? `Task resumed and scheduled for ${targetDate}`
        : mode === "rework"
          ? `Task sent to rework for ${targetDate}`
          : `Task scheduled for ${targetDate}`,
    );
    setActiveActionTask(null);
  };

  const handleQuickAssignDate = (task: Task, targetDate: string) => {
    update((d) => {
      const t = d.tasks.find((x) => x.id === task.id);
      if (!t) return;
      t.plannedDate = targetDate;
      t.dueDate = targetDate;
    });
    log("Task scheduled", `${task.title} → ${targetDate}`);
    toast.success(`Scheduled "${task.title}" for ${targetDate}`);
  };

  const handleCreateQuickPlannedTask = (targetDate: string) => {
    if (!quickPlanTitle.trim()) {
      toast.error("Enter a task title.");
      return;
    }
    const targetAssignee =
      isAdmin && memberScope !== "me" && memberScope !== "all" ? memberScope : me.id;

    update((d) => {
      d.tasks.unshift({
        id: newId(),
        title: quickPlanTitle.trim(),
        description: quickPlanDesc.trim(),
        assigneeId: targetAssignee,
        assignedById: me.id,
        priority: quickPlanPriority,
        status: "assigned",
        cadence: "weekly",
        startDate: todayKey,
        dueDate: targetDate,
        plannedDate: targetDate,
        requiredProof: "any",
        proofs: [],
        comments: [],
      });
    });

    if (targetAssignee !== me.id) {
      notify(
        targetAssignee,
        "Weekly Task Planned",
        `${me.fullName} scheduled "${quickPlanTitle.trim()}" for ${targetDate}.`,
        "/tasks",
      );
    }
    log("Weekly task planned", `${quickPlanTitle.trim()} → ${targetDate}`);
    toast.success(`Planned "${quickPlanTitle.trim()}" for ${targetDate}`);
    setQuickPlanDay(null);
    setQuickPlanTitle("");
    setQuickPlanDesc("");
    setQuickPlanPriority("medium");
  };

  const renderInlineScheduler = (task: Task) => {
    if (!activeActionTask || activeActionTask.taskId !== task.id) return null;
    const isRework = activeActionTask.mode === "rework";
    const isResume = activeActionTask.mode === "resume";

    return (
      <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-foreground">
            {isResume
              ? "Resume task — choose when to do it (Present or Coming Week)"
              : isRework
                ? "Send for rework — choose target day (Present or Coming Week)"
                : "Set planned day (Present or Coming Week)"}
          </p>
          <span className="text-xs font-mono tabular-nums text-muted-foreground">
            Selected: {activeActionTask.targetDate}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {/* This Week Mon-Fri quick buttons */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">
              Present Week ({formatWorkweekRange(currentWeekDays)})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {currentWeekDays.map((d) => {
                const selected = activeActionTask.targetDate === d.dateKey;
                return (
                  <button
                    key={d.dateKey}
                    type="button"
                    onClick={() =>
                      setActiveActionTask((prev) =>
                        prev ? { ...prev, targetDate: d.dateKey } : prev,
                      )
                    }
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-foreground border-border hover:border-primary/50"
                    }`}
                  >
                    {d.dayShort} · {d.shortDate}
                    {d.isToday ? " (Today)" : ""}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Next Week Mon-Fri quick buttons */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">
              Coming Week ({formatWorkweekRange(nextWeekDays)})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {nextWeekDays.map((d) => {
                const selected = activeActionTask.targetDate === d.dateKey;
                return (
                  <button
                    key={d.dateKey}
                    type="button"
                    onClick={() =>
                      setActiveActionTask((prev) =>
                        prev ? { ...prev, targetDate: d.dateKey } : prev,
                      )
                    }
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-foreground border-border hover:border-primary/50"
                    }`}
                  >
                    {d.dayShort} · {d.shortDate}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <div className="space-y-1">
            <Label htmlFor={`plan-date-${task.id}`} className="text-xs">
              Custom Date
            </Label>
            <Input
              id={`plan-date-${task.id}`}
              type="date"
              value={activeActionTask.targetDate}
              onChange={(e) =>
                setActiveActionTask((prev) =>
                  prev ? { ...prev, targetDate: e.target.value } : prev,
                )
              }
              className="h-9 text-xs tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`plan-note-${task.id}`} className="text-xs">
              {isRework ? "Rework notes (optional)" : "Planning note (optional)"}
            </Label>
            <Input
              id={`plan-note-${task.id}`}
              value={activeActionTask.note}
              onChange={(e) =>
                setActiveActionTask((prev) => (prev ? { ...prev, note: e.target.value } : prev))
              }
              placeholder={
                isRework
                  ? "What needs adjustment or rework…"
                  : "Note on next steps or deliverables…"
              }
              className="h-9 text-xs"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setActiveActionTask(null)}
            className="whitespace-nowrap shrink-0"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => handleConfirmInlineAction(task)}
            className="gap-1.5 whitespace-nowrap shrink-0"
          >
            {isResume ? (
              <>
                <Play className="h-3.5 w-3.5" /> Confirm Resume
              </>
            ) : isRework ? (
              <>
                <RotateCcw className="h-3.5 w-3.5" /> Confirm Rework
              </>
            ) : (
              <>
                <Calendar className="h-3.5 w-3.5" /> Save Schedule
              </>
            )}
          </Button>
        </div>
      </div>
    );
  };

  const renderWeekScheduleSection = (title: string, subtitle: string, days: WorkweekDay[]) => {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground tabular-nums">{subtitle}</p>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {
              scopedTasks.filter((t) => days.some((d) => d.dateKey === getTaskScheduledDate(t)))
                .length
            }{" "}
            scheduled
          </span>
        </div>

        <div className="space-y-3">
          {days.map((day) => {
            const dayTasks = scopedTasks.filter((t) => getTaskScheduledDate(t) === day.dateKey);
            const isAddingHere = quickPlanDay === day.dateKey;

            return (
              <div
                key={day.dateKey}
                className="rounded-xl border border-border bg-card p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-foreground">{day.dayFull}</span>
                    <span aria-hidden="true" className="text-muted-foreground">
                      ·
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {day.shortDate} ({day.dateKey})
                    </span>
                    {day.isToday && (
                      <>
                        <span aria-hidden="true" className="text-muted-foreground">
                          ·
                        </span>
                        <span className="text-xs font-semibold text-primary">Today</span>
                      </>
                    )}
                    <span aria-hidden="true" className="text-muted-foreground">
                      ·
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {dayTasks.length} {dayTasks.length === 1 ? "task" : "tasks"}
                    </span>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (isAddingHere) {
                        setQuickPlanDay(null);
                      } else {
                        setQuickPlanDay(day.dateKey);
                        setQuickPlanTitle("");
                        setQuickPlanDesc("");
                      }
                    }}
                    className="h-8 gap-1 text-xs whitespace-nowrap shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {isAddingHere ? "Close" : `Plan for ${day.dayShort}`}
                  </Button>
                </div>

                {isAddingHere && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                      <div className="space-y-1">
                        <Label htmlFor={`quick-title-${day.dateKey}`} className="text-xs">
                          Task title for {day.dayFull} ({day.shortDate})
                        </Label>
                        <Input
                          id={`quick-title-${day.dateKey}`}
                          value={quickPlanTitle}
                          onChange={(e) => setQuickPlanTitle(e.target.value)}
                          placeholder="e.g. Follow up on partner onboarding"
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Priority</Label>
                        <Select
                          value={quickPlanPriority}
                          onValueChange={(v) => setQuickPlanPriority(v as Priority)}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(["low", "medium", "high", "urgent"] as const).map((p) => (
                              <SelectItem key={p} value={p}>
                                {titleCase(p)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`quick-desc-${day.dateKey}`} className="text-xs">
                        Details (optional)
                      </Label>
                      <Textarea
                        id={`quick-desc-${day.dateKey}`}
                        rows={2}
                        value={quickPlanDesc}
                        onChange={(e) => setQuickPlanDesc(e.target.value)}
                        placeholder="Scope or notes for this day…"
                        className="text-xs"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setQuickPlanDay(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleCreateQuickPlannedTask(day.dateKey)}
                      >
                        Save to {day.dayShort}
                      </Button>
                    </div>
                  </div>
                )}

                {dayTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">
                    No tasks scheduled for {day.dayFull}. Use &quot;Plan for {day.dayShort}&quot; or
                    move a task here.
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {dayTasks.map((task) => {
                      const assignee = state.users.find((u) => u.id === task.assigneeId);
                      const canAct = isAdmin || task.assigneeId === me.id;
                      const done = isDoneStatus(task.status);

                      return (
                        <div key={task.id} className="py-3 first:pt-1 last:pb-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{titleCase(task.priority)} priority</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatWeeklyActionLabel(task.weeklyAction)}</span>
                                {assignee && isAdmin && memberScope !== "me" && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{assignee.fullName}</span>
                                  </>
                                )}
                              </div>
                              <p className="text-sm font-semibold text-foreground">{task.title}</p>
                              {task.description && (
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {task.description}
                                </p>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <StatusPill value={task.status} />
                              {canAct && (
                                <>
                                  {(!done || task.weeklyAction !== "done") && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleMarkDone(task)}
                                      className="h-8 gap-1 text-xs whitespace-nowrap shrink-0"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Done
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openInlineAction(task, "resume")}
                                    className="h-8 gap-1 text-xs whitespace-nowrap shrink-0"
                                  >
                                    <Play className="h-3.5 w-3.5" /> Resume
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openInlineAction(task, "rework")}
                                    className="h-8 gap-1 text-xs whitespace-nowrap shrink-0"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" /> Rework
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openInlineAction(task, "schedule")}
                                    className="h-8 gap-1 text-xs whitespace-nowrap shrink-0"
                                  >
                                    <Calendar className="h-3.5 w-3.5" /> Move
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          {renderInlineScheduler(task)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Toolbar: View Mode + Member Scope */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setViewMode("review")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              viewMode === "review"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Mon–Fri Completed Review
          </button>
          <button
            type="button"
            onClick={() => setViewMode("schedule")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              viewMode === "schedule"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Present &amp; Coming Week Planner
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Select value={memberScope} onValueChange={setMemberScope}>
              <SelectTrigger className="w-48 h-9 text-xs">
                <SelectValue placeholder="Filter member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Team Members</SelectItem>
                <SelectItem value="me">My Tasks Only ({me.fullName})</SelectItem>
                {teamMembers
                  .filter((u) => u.id !== me.id)
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.fullName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {viewMode === "review" ? (
        <div className="space-y-5">
          {/* Week Switcher & Summary */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Monday–Friday Completed Tasks Check-in
                </h2>
                {isMonday && (
                  <span className="text-xs font-medium text-primary">Monday check-in ready</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Review tasks completed from Monday to Friday and mark them as Done, Resume, or send
                to Rework for the present or coming week.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => {
                  setReviewWeek("last");
                  setSelectedDayKey("all");
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  reviewWeek === "last"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Last Week ({formatWorkweekRange(lastWeekDays)}) · {lastWeekCompletedAll.length}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReviewWeek("current");
                  setSelectedDayKey("all");
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  reviewWeek === "current"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                This Week ({formatWorkweekRange(currentWeekDays)}) ·{" "}
                {currentWeekCompletedAll.length}
              </button>
            </div>
          </div>

          {/* 4-column Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Completed (Mon–Fri)</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">
                {weekCompletedTasks.length}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Needs Decision</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">
                {pendingDecisionCount}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Marked Done</p>
              <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {markedDoneCount}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Resumed / Rework</p>
              <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                {reopenedCount}
              </p>
            </div>
          </div>

          {/* Mon–Fri Day Filter + Review State Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setSelectedDayKey("all")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  selectedDayKey === "all"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All Mon–Fri ({weekCompletedTasks.length})
              </button>
              {activeReviewDays.map((d) => {
                const count = dayCounts.get(d.dateKey) ?? 0;
                const active = selectedDayKey === d.dateKey;
                return (
                  <button
                    key={d.dateKey}
                    type="button"
                    onClick={() => setSelectedDayKey(d.dateKey)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                      active
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {d.dayShort} {d.shortDate} ({count})
                  </button>
                );
              })}
            </div>

            <Select
              value={reviewStatusFilter}
              onValueChange={(v) => setReviewStatusFilter(v as typeof reviewStatusFilter)}
            >
              <SelectTrigger className="w-44 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Review States</SelectItem>
                <SelectItem value="pending">Needs Check-in</SelectItem>
                <SelectItem value="done">Marked Done</SelectItem>
                <SelectItem value="reopened">Resumed / Rework</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Completed Tasks Review List */}
          {filteredReviewTasks.length === 0 ? (
            <EmptyState
              title={`No completed tasks found for ${
                reviewWeek === "last" ? "Last Week" : "This Week"
              } (Mon–Fri)`}
              hint="Completed or approved tasks from Monday through Friday appear here so you can mark them Done, Resume, or send them to Rework when you check in."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setReviewWeek((prev) => (prev === "last" ? "current" : "last"))}
                  >
                    Switch to {reviewWeek === "last" ? "This Week" : "Last Week"}
                  </Button>
                  <Button type="button" size="sm" onClick={() => setViewMode("schedule")}>
                    Open Present &amp; Coming Week Planner
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredReviewTasks.map((task) => {
                const compDate = getTaskWeekDate(task);
                const dayInfo = activeReviewDayMap.get(compDate);
                const assignee = state.users.find((u) => u.id === task.assigneeId);
                const canAct = isAdmin || task.assigneeId === me.id;
                const latestComment =
                  task.comments.length > 0 ? task.comments[task.comments.length - 1] : null;

                return (
                  <div
                    key={task.id}
                    className="rounded-xl border border-border bg-card p-5 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {dayInfo ? `${dayInfo.dayFull}, ${dayInfo.shortDate}` : compDate}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{titleCase(task.priority)} priority</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              task.weeklyAction === "done"
                                ? "font-medium text-emerald-600 dark:text-emerald-400"
                                : task.weeklyAction === "rework" || task.weeklyAction === "resumed"
                                  ? "font-medium text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground"
                            }
                          >
                            {formatWeeklyActionLabel(task.weeklyAction)}
                          </span>
                          {task.plannedDate && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums text-foreground">
                                Planned: {task.plannedDate}
                              </span>
                            </>
                          )}
                        </div>

                        <h3 className="text-base font-semibold text-foreground">{task.title}</h3>
                        {task.description && (
                          <p className="text-sm text-muted-foreground">{task.description}</p>
                        )}

                        {assignee && isAdmin && memberScope !== "me" && (
                          <div className="pt-1 flex items-center gap-2 text-xs">
                            <Initials
                              name={assignee.fullName}
                              color={assignee.avatarColor}
                              src={assignee.avatarUrl}
                              size={20}
                            />
                            <span className="font-medium text-foreground">{assignee.fullName}</span>
                            <span className="text-muted-foreground">({assignee.designation})</span>
                          </div>
                        )}

                        {latestComment && (
                          <p className="pt-1 text-xs text-muted-foreground">
                            Latest note: {latestComment.body}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <StatusPill value={task.status} />
                        {canAct && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant={task.weeklyAction === "done" ? "secondary" : "default"}
                              onClick={() => handleMarkDone(task)}
                              className="h-8 gap-1.5 text-xs whitespace-nowrap shrink-0"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {task.weeklyAction === "done" ? "Done" : "Mark Done"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openInlineAction(task, "resume")}
                              className="h-8 gap-1.5 text-xs whitespace-nowrap shrink-0"
                            >
                              <Play className="h-3.5 w-3.5" /> Resume
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openInlineAction(task, "rework")}
                              className="h-8 gap-1.5 text-xs whitespace-nowrap shrink-0"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Rework
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => onEditTask(task)}
                              className="h-8 text-xs whitespace-nowrap shrink-0"
                            >
                              Edit
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {renderInlineScheduler(task)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Planner Header & Week Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">
                Present &amp; Coming Week Task Schedule (Mon–Fri)
              </h2>
              <p className="text-xs text-muted-foreground">
                Decide exactly which day in the current or upcoming week you want to work on active,
                resumed, or rework tasks.
              </p>
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setScheduleScope("both")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  scheduleScope === "both"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Both Weeks
              </button>
              <button
                type="button"
                onClick={() => setScheduleScope("current")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  scheduleScope === "current"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Present Week ({formatWorkweekRange(currentWeekDays)})
              </button>
              <button
                type="button"
                onClick={() => setScheduleScope("next")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  scheduleScope === "next"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Coming Week ({formatWorkweekRange(nextWeekDays)})
              </button>
            </div>
          </div>

          <div
            className={`grid gap-6 ${scheduleScope === "both" ? "xl:grid-cols-2" : "grid-cols-1"}`}
          >
            {(scheduleScope === "both" || scheduleScope === "current") &&
              renderWeekScheduleSection(
                "Present Week (Mon–Fri)",
                formatWorkweekRange(currentWeekDays),
                currentWeekDays,
              )}
            {(scheduleScope === "both" || scheduleScope === "next") &&
              renderWeekScheduleSection(
                "Coming Week (Mon–Fri)",
                formatWorkweekRange(nextWeekDays),
                nextWeekDays,
              )}
          </div>

          {/* Unscheduled / Backlog Active Tasks */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">
                  Unscheduled Open Tasks ({unscheduledActiveTasks.length})
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">
                Pick a weekday to move any open or rework task into your present or coming week
              </span>
            </div>

            {unscheduledActiveTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                All active tasks are scheduled within the present or coming Mon–Fri workweeks.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {unscheduledActiveTasks.map((task) => {
                  const canAct = isAdmin || task.assigneeId === me.id;
                  return (
                    <div
                      key={task.id}
                      className="py-3 first:pt-1 last:pb-1 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>Due: {task.dueDate}</span>
                          <span aria-hidden="true">·</span>
                          <span>{titleCase(task.priority)} priority</span>
                        </div>
                        <p className="text-sm font-semibold text-foreground">{task.title}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <StatusPill value={task.status} />
                        {canAct && (
                          <Select
                            value=""
                            onValueChange={(targetDate) => handleQuickAssignDate(task, targetDate)}
                          >
                            <SelectTrigger className="w-52 h-8 text-xs">
                              <SelectValue placeholder="Schedule to week day…" />
                            </SelectTrigger>
                            <SelectContent>
                              {presentAndComingDays.map((d) => (
                                <SelectItem key={d.dateKey} value={d.dateKey}>
                                  <span className="flex items-center gap-1.5 tabular-nums">
                                    <ChevronRight className="h-3 w-3" />
                                    {d.weekLabel} · {d.dayShort} ({d.shortDate})
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
