import { z } from "zod";
import type { UserPresence } from "./types";

export const PRESENCE_SESSION_KEY = "workpulse_presence_set";

export const UpdatePresenceSchema = z.object({
  status: z.string().trim().min(1, "Status is required.").max(60),
  isCustomStatus: z.boolean().default(false),
  availableFor: z.string().trim().min(1, "Availability context is required.").max(60),
  isCustomAvailability: z.boolean().default(false),
  durationMinutes: z
    .union([
      z.literal(15),
      z.literal(30),
      z.literal(60),
      z.literal(120),
      z.literal("FULL_SHIFT"),
      z.literal("CUSTOM"),
    ])
    .default(60),
  customStartTime: z.string().max(64).nullable().optional(),
  customEndTime: z.string().max(64).nullable().optional(),
});

export const CreateBattalionSchema = z.object({
  name: z.string().trim().min(2, "Battalion name must be at least 2 characters.").max(80),
  description: z.string().trim().max(400).default(""),
  memberIds: z
    .array(z.string().trim().min(1).max(64))
    .min(1, "Select at least one team member for this battalion.")
    .max(200),
});

export const DeleteBattalionSchema = z.object({
  battalionId: z.string().trim().min(1).max(64),
});

export type UpdatePresenceInput = z.infer<typeof UpdatePresenceSchema>;
export type CreateBattalionInput = z.infer<typeof CreateBattalionSchema>;

export type TimeWindowChoice = 15 | 30 | 60 | 120 | "FULL_SHIFT" | "CUSTOM";

export const TIME_WINDOW_OPTIONS: ReadonlyArray<{
  value: TimeWindowChoice;
  label: string;
  shortLabel: string;
}> = [
  { value: 15, label: "Next 15 mins", shortLabel: "15m" },
  { value: 30, label: "Next 30 mins", shortLabel: "30m" },
  { value: 60, label: "Next 1 hour", shortLabel: "1h" },
  { value: 120, label: "Next 2 hours", shortLabel: "2h" },
  { value: "FULL_SHIFT", label: "Full Shift", shortLabel: "Full Shift" },
  { value: "CUSTOM", label: "Custom Time Range", shortLabel: "Custom" },
];

export const AVAILABLE_FOR_PRESETS = ["1o1", "GTGs", "Doubts", "Talk", "Mini Talk"] as const;

export const LIVE_STATUS_PRESETS = [
  "On Desk",
  "Open for Task",
  "On a Task",
  "In 1o1",
  "In Meeting",
  "Break",
  "At Client Place",
  "At Visits",
] as const;

export const BATTALION_STATUS_FILTERS = [
  "ALL",
  "Open for Task",
  "On Desk",
  "In 1o1",
  "In Meeting",
  "Break",
] as const;

export interface AvailabilityWindowInput {
  durationMinutes?: TimeWindowChoice;
  customStartTime?: string | null;
  customEndTime?: string | null;
  now?: Date;
}

/**
 * Calculates `availableFrom` and `availableUntil` ISO timestamps using clean millisecond math.
 * Avoids cron jobs by encoding expiration directly in `availableUntil`.
 */
export function calculateAvailabilityWindow(input: AvailabilityWindowInput): {
  availableFrom: string;
  availableUntil: string;
} {
  const nowDate = input.now ?? new Date();
  const duration = input.durationMinutes ?? 60;

  if (duration === "CUSTOM") {
    const startParsed = input.customStartTime ? new Date(input.customStartTime) : nowDate;
    if (Number.isNaN(startParsed.getTime())) {
      throw new Error("Invalid custom start time.");
    }
    if (!input.customEndTime) {
      throw new Error("Please select an end time for the custom range.");
    }
    const endParsed = new Date(input.customEndTime);
    if (Number.isNaN(endParsed.getTime())) {
      throw new Error("Invalid custom end time.");
    }
    if (endParsed.getTime() <= startParsed.getTime()) {
      throw new Error("Custom 'Until' time must be later than 'From' time.");
    }
    return {
      availableFrom: startParsed.toISOString(),
      availableUntil: endParsed.toISOString(),
    };
  }

  if (duration === "FULL_SHIFT") {
    const shiftEnd = new Date(nowDate);
    shiftEnd.setHours(18, 30, 0, 0);
    if (shiftEnd.getTime() <= nowDate.getTime()) {
      shiftEnd.setTime(nowDate.getTime() + 9 * 60 * 60 * 1000);
    }
    return {
      availableFrom: nowDate.toISOString(),
      availableUntil: shiftEnd.toISOString(),
    };
  }

  const numericMinutes = Number(duration);
  if (!Number.isFinite(numericMinutes) || numericMinutes <= 0 || numericMinutes > 24 * 60) {
    throw new Error("Duration must be between 1 and 1440 minutes.");
  }

  const untilDate = new Date(nowDate.getTime() + numericMinutes * 60 * 1000);
  return {
    availableFrom: nowDate.toISOString(),
    availableUntil: untilDate.toISOString(),
  };
}

export function isPresenceExpired(
  presence: Pick<UserPresence, "availableUntil"> | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!presence?.availableUntil) return false;
  const untilMs = new Date(presence.availableUntil).getTime();
  if (Number.isNaN(untilMs)) return false;
  return untilMs <= nowMs;
}

/**
 * Formats live countdown remaining until `availableUntil` without relying on server cron jobs.
 */
export function formatRemainingTime(
  availableUntil: string | null | undefined,
  nowMs = Date.now(),
): string {
  if (!availableUntil) return "No timer";
  const untilMs = new Date(availableUntil).getTime();
  if (Number.isNaN(untilMs)) return "No timer";

  const diffMs = untilMs - nowMs;
  if (diffMs <= 0) return "Expired";

  const totalMinutes = Math.ceil(diffMs / (60 * 1000));
  if (totalMinutes < 60) {
    return `${totalMinutes}m left`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
}

export function getPresenceStatusTone(status: string, expired = false): string {
  if (expired) {
    return "border-border bg-muted/70 text-muted-foreground";
  }

  switch (status) {
    case "Open for Task":
      return "border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "On Desk":
      return "border-sky-500/35 bg-sky-500/15 text-sky-700 dark:text-sky-300";
    case "On a Task":
      return "border-indigo-500/35 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300";
    case "In 1o1":
    case "In Meeting":
      return "border-[#8A007E]/40 bg-[#5B00A3]/15 text-[#5B00A3] dark:border-purple-400/35 dark:bg-purple-500/20 dark:text-purple-200";
    case "Break":
      return "border-amber-500/35 bg-amber-500/15 text-amber-800 dark:text-amber-300";
    case "At Client Place":
    case "At Visits":
      return "border-teal-500/35 bg-teal-500/15 text-teal-700 dark:text-teal-300";
    default:
      return "border-fuchsia-500/35 bg-fuchsia-500/15 text-fuchsia-800 dark:text-fuchsia-200";
  }
}

export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
