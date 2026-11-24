import type { TaskCadence } from "./types";

export const CADENCES: TaskCadence[] = ["today", "weekly", "monthly", "quarterly"];

export function cadenceLabel(cadence: TaskCadence): string {
  switch (cadence) {
    case "today":
      return "Today";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    default:
      return cadence;
  }
}

export function cadenceDueDate(cadence: TaskCadence): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");

  switch (cadence) {
    case "today":
      return `${y}-${m}-${d}`;
    case "weekly": {
      const next = new Date(today);
      next.setDate(today.getDate() + (7 - today.getDay()));
      const yy = next.getFullYear();
      const mm = String(next.getMonth() + 1).padStart(2, "0");
      const dd = String(next.getDate()).padStart(2, "0");
      return `${yy}-${mm}-${dd}`;
    }
    case "monthly": {
      const last = new Date(y, today.getMonth() + 1, 0);
      const mm = String(last.getMonth() + 1).padStart(2, "0");
      const dd = String(last.getDate()).padStart(2, "0");
      return `${last.getFullYear()}-${mm}-${dd}`;
    }
    case "quarterly": {
      const quarterEndMonth = Math.floor(today.getMonth() / 3) * 3 + 3;
      const last = new Date(y, quarterEndMonth, 0);
      const mm = String(last.getMonth() + 1).padStart(2, "0");
      const dd = String(last.getDate()).padStart(2, "0");
      return `${last.getFullYear()}-${mm}-${dd}`;
    }
    default:
      return `${y}-${m}-${d}`;
  }
}
export function getMonthlyReviewEffectiveDate(
  year: number,
  month: number, // 1-indexed (1 = Jan, 12 = Dec)
  holidays: { date: string }[] = [],
): Date {
  const holidayDates = new Set(holidays.map((h) => h.date));
  let time = new Date(year, month - 1, 14).getTime();
  while (true) {
    const d = new Date(time);
    const dayOfWeek = d.getDay();
    const dKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = holidayDates.has(dKey);
    if (!isWeekend && !isHoliday) {
      return d;
    }
    time -= 86400000;
  }
}

export function isMonthlyReviewDayToday(
  holidays: { date: string }[] = [],
  now: Date = new Date(),
): boolean {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const eff = getMonthlyReviewEffectiveDate(y, m, holidays);
  const yyyy = eff.getFullYear();
  const mm = String(eff.getMonth() + 1).padStart(2, "0");
  const dd = String(eff.getDate()).padStart(2, "0");
  const effKey = `${yyyy}-${mm}-${dd}`;

  const ny = now.getFullYear();
  const nm = String(now.getMonth() + 1).padStart(2, "0");
  const nd = String(now.getDate()).padStart(2, "0");
  const todayKey = `${ny}-${nm}-${nd}`;

  return todayKey === effKey;
}

export interface WorkweekDay {
  dateKey: string;
  dayShort: string;
  dayFull: string;
  shortDate: string;
  isToday: boolean;
}

const WEEKDAY_NAMES_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const WEEKDAY_NAMES_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getMondayOfWeek(refDate: Date = new Date(), weekOffset = 0): Date {
  const base = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const jsDay = base.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  base.setDate(base.getDate() + diffToMonday + weekOffset * 7);
  return base;
}

export function getWorkweekDays(refDate: Date = new Date(), weekOffset = 0): WorkweekDay[] {
  const monday = getMondayOfWeek(refDate, weekOffset);
  const todayKey = toLocalDateKey(refDate);
  const days: WorkweekDay[] = [];

  for (let i = 0; i < 5; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key = toLocalDateKey(d);
    const monthLabel = MONTH_NAMES_SHORT[d.getMonth()] ?? "";
    days.push({
      dateKey: key,
      dayShort: WEEKDAY_NAMES_SHORT[i] ?? "Day",
      dayFull: WEEKDAY_NAMES_FULL[i] ?? "Weekday",
      shortDate: `${monthLabel} ${d.getDate()}`,
      isToday: key === todayKey,
    });
  }
  return days;
}

export function formatWorkweekRange(days: WorkweekDay[]): string {
  if (days.length === 0) return "";
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return `${first.shortDate} – ${last.shortDate}`;
}

export function resolveTaskCompletionDateKey(task: {
  status: string;
  completedAt?: string | null;
  proofs?: Array<{ submittedAt: string }>;
  dueDate: string;
}): string | null {
  if (task.status !== "completed" && task.status !== "approved") {
    return null;
  }
  if (task.completedAt && task.completedAt.length >= 10) {
    return task.completedAt.slice(0, 10);
  }
  if (task.proofs && task.proofs.length > 0) {
    const sorted = task.proofs
      .map((p) => p.submittedAt)
      .filter(Boolean)
      .sort();
    const latest = sorted[sorted.length - 1];
    if (latest && latest.length >= 10) {
      return latest.slice(0, 10);
    }
  }
  return task.dueDate && task.dueDate.length >= 10 ? task.dueDate.slice(0, 10) : null;
}
