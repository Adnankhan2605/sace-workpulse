import { z } from "zod";
import { PASSWORD_POLICY_ERROR, isSafeImageSrc, isStrongPassword } from "./security.ts";
import { WEEKDAYS, WORK_MODE_VALUES, type Perm, type User } from "./types.ts";

export const ALL_VALID_PERMS = [
  "manage_users",
  "manage_admins",
  "approve_leave",
  "upload_leads",
  "view_all_tickets",
  "view_reports",
  "view_all_eod",
  "manage_recognition",
  "manage_holidays",
  "system_settings",
] as const satisfies readonly Perm[];

const NullableTimeSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm time format (e.g. 09:30).")
    .nullable()
    .optional(),
);

const NullableWeekOffsSchema = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (!Array.isArray(v)) return null;
    return v;
  },
  z.array(z.enum(WEEKDAYS)).max(7).nullable().optional(),
);

const OptionalQuotaSchema = (fallback: number) =>
  z.preprocess((v) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }, z.number().int().min(0).max(365).optional());

const OptionalWorkModeSchema = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return undefined;
  return v;
}, z.enum(WORK_MODE_VALUES).optional());

const OptionalBooleanSchema = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return undefined;
  return v;
}, z.boolean().optional());

export function normalizeAccountPayloadKeys(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const src = { ...(raw as Record<string, unknown>) };
  if (src["shiftStartTime"] === undefined && src["shift_start_time"] !== undefined) {
    src["shiftStartTime"] = src["shift_start_time"];
  }
  if (src["shiftEndTime"] === undefined && src["shift_end_time"] !== undefined) {
    src["shiftEndTime"] = src["shift_end_time"];
  }
  if (src["weekOffs"] === undefined && src["week_offs"] !== undefined) {
    src["weekOffs"] = src["week_offs"];
  }
  if (src["casualBalance"] === undefined && src["casual_balance"] !== undefined) {
    src["casualBalance"] = src["casual_balance"];
  }
  if (src["sickBalance"] === undefined && src["sick_balance"] !== undefined) {
    src["sickBalance"] = src["sick_balance"];
  }
  if (src["workMode"] === undefined && src["work_mode"] !== undefined) {
    src["workMode"] = src["work_mode"];
  }
  if (src["geoFenceMandatory"] === undefined && src["geo_fence_mandatory"] !== undefined) {
    src["geoFenceMandatory"] = src["geo_fence_mandatory"];
  }
  return src;
}

export function isUserScheduleConfigured(
  user: Pick<User, "shiftStartTime" | "shiftEndTime" | "weekOffs"> | null | undefined,
): boolean {
  if (!user) return false;
  return Boolean(
    (typeof user.shiftStartTime === "string" && user.shiftStartTime.trim().length > 0) ||
    (typeof user.shiftEndTime === "string" && user.shiftEndTime.trim().length > 0) ||
    (Array.isArray(user.weekOffs) && user.weekOffs.length > 0),
  );
}

export const CreateAccountSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(160),
  password: z
    .string()
    .min(12, PASSWORD_POLICY_ERROR)
    .max(128)
    .refine(isStrongPassword, { message: PASSWORD_POLICY_ERROR }),
  designation: z.string().trim().max(100).optional().default("Team Member"),
  department: z.string().trim().max(100).optional().default("General"),
  role: z.enum(["super_admin", "admin", "member"]).default("member"),
  reportingAdminId: z.string().max(64).nullable().optional().default(null),
  avatarColor: z.string().trim().min(1).max(48).optional().default("var(--brand-gold)"),
  skipSchedule: z.boolean().optional().default(false),
  casualBalance: OptionalQuotaSchema(12),
  sickBalance: OptionalQuotaSchema(12),
  shiftStartTime: NullableTimeSchema,
  shiftEndTime: NullableTimeSchema,
  weekOffs: NullableWeekOffsSchema,
  workMode: OptionalWorkModeSchema,
  geoFenceMandatory: OptionalBooleanSchema,
});

export type CreateAccountInput = z.input<typeof CreateAccountSchema>;

export const SaveAccountSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  fullName: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().max(160).optional(),
  designation: z.string().trim().min(1).max(100).optional(),
  department: z.string().trim().min(1).max(100).optional(),
  dailyVision: z.string().max(400).nullable().optional(),
  avatarUrl: z
    .string()
    .max(600_000)
    .refine((val) => isSafeImageSrc(val), { message: "Invalid avatar image URL." })
    .nullable()
    .optional(),
  reportingAdminId: z.string().max(64).nullable().optional(),
  casualBalance: OptionalQuotaSchema(12),
  sickBalance: OptionalQuotaSchema(12),
  shiftStartTime: NullableTimeSchema,
  shiftEndTime: NullableTimeSchema,
  weekOffs: NullableWeekOffsSchema,
  workMode: OptionalWorkModeSchema,
  geoFenceMandatory: OptionalBooleanSchema,
  active: z.boolean().optional(),
  role: z.enum(["super_admin", "admin", "member"]).optional(),
  password: z
    .string()
    .min(12, PASSWORD_POLICY_ERROR)
    .max(128)
    .refine(isStrongPassword, { message: PASSWORD_POLICY_ERROR })
    .optional(),
});

export type SaveAccountInput = z.input<typeof SaveAccountSchema>;

export const DeleteAccountSchema = z.object({
  userId: z.string().trim().min(1).max(64),
});

export const SaveAdminPermsSchema = z.object({
  perms: z.array(z.enum(ALL_VALID_PERMS)).max(ALL_VALID_PERMS.length),
});
