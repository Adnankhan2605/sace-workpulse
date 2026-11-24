import { z } from "zod";
import { PASSWORD_POLICY_ERROR, isSafeImageSrc, isStrongPassword } from "./security.ts";
import type { Perm } from "./types.ts";

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

export const CreateAccountSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(160),
  password: z
    .string()
    .min(12, PASSWORD_POLICY_ERROR)
    .max(128)
    .refine(isStrongPassword, { message: PASSWORD_POLICY_ERROR }),
  designation: z.string().trim().min(1).max(100),
  department: z.string().trim().min(1).max(100),
  role: z.enum(["super_admin", "admin", "member"]).default("member"),
  reportingAdminId: z.string().max(64).nullable().optional().default(null),
  avatarColor: z.string().trim().min(1).max(48).optional().default("var(--brand-gold)"),
  casualBalance: z.number().int().min(0).max(365).optional(),
  sickBalance: z.number().int().min(0).max(365).optional(),
});

export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;

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
  casualBalance: z.number().int().min(0).max(365).optional(),
  sickBalance: z.number().int().min(0).max(365).optional(),
  active: z.boolean().optional(),
  role: z.enum(["super_admin", "admin", "member"]).optional(),
  password: z
    .string()
    .min(12, PASSWORD_POLICY_ERROR)
    .max(128)
    .refine(isStrongPassword, { message: PASSWORD_POLICY_ERROR })
    .optional(),
});

export type SaveAccountInput = z.infer<typeof SaveAccountSchema>;

export const DeleteAccountSchema = z.object({
  userId: z.string().trim().min(1).max(64),
});

export const SaveAdminPermsSchema = z.object({
  perms: z.array(z.enum(ALL_VALID_PERMS)).max(ALL_VALID_PERMS.length),
});
