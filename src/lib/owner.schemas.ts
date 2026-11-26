import { z } from "zod";
import type { AttendanceRecord, EodReport, LeaveRequest, Role, Task, WorkMode } from "./types";

export const INITIATIVE_STATUS_VALUES = ["on_track", "at_risk", "completed"] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUS_VALUES)[number];

export const INITIATIVE_STATUS_LABELS: Record<InitiativeStatus, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  completed: "Completed",
};

export const CreateCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters.")
    .max(120, "Company name cannot exceed 120 characters."),
  code: z.string().trim().max(24).optional().default(""),
  vertical: z.string().trim().max(80).optional().default(""),
  description: z.string().trim().max(500).optional().default(""),
  leadUserId: z.string().trim().max(64).nullable().optional().default(null),
  memberIds: z.array(z.string().trim().min(1).max(64)).max(500).optional().default([]),
  active: z.boolean().optional().default(true),
});

export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;

export const UpdateCompanySchema = CreateCompanySchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  "Provide at least one field to update.",
);

export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;

export const CreateInitiativeSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Initiative title must be at least 2 characters.")
    .max(160, "Initiative title cannot exceed 160 characters."),
  description: z.string().trim().max(1000).optional().default(""),
  companyId: z.string().trim().max(64).nullable().optional().default(null),
  battalionId: z.string().trim().max(64).nullable().optional().default(null),
  leadUserId: z.string().trim().max(64).nullable().optional().default(null),
  status: z.enum(INITIATIVE_STATUS_VALUES).optional().default("on_track"),
  progress: z.coerce
    .number()
    .int()
    .min(0, "Progress must be at least 0%.")
    .max(100, "Progress cannot exceed 100%.")
    .optional()
    .default(0),
  dueDate: z
    .string()
    .trim()
    .max(32)
    .refine(
      (val) => val === "" || /^\d{4}-\d{2}-\d{2}$/.test(val),
      "Target date must be in YYYY-MM-DD format.",
    )
    .nullable()
    .optional()
    .default(null),
});

export type CreateInitiativeInput = z.infer<typeof CreateInitiativeSchema>;

export const UpdateInitiativeSchema = CreateInitiativeSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  "Provide at least one field to update.",
);

export type UpdateInitiativeInput = z.infer<typeof UpdateInitiativeSchema>;

export interface OwnerKpis {
  totalCompanies: number;
  activeCompanies: number;
  totalAssignedCompanyStaff: number;
  totalInitiatives: number;
  activeInitiatives: number;
  completedInitiatives: number;
  atRiskInitiatives: number;
  overallInitiativeCompletionPct: number;
  totalVisibleUsers: number;
  activeStaffCount: number;
  checkedInTodayCount: number;
  checkedOutTodayCount: number;
  onLeaveTodayCount: number;
  lateTodayCount: number;
  notCheckedInCount: number;
  attendanceRateTodayPct: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksPending: number;
  tasksOverdue: number;
  taskCompletionRatePct: number;
  eodsSubmittedToday: number;
  eodExpectedToday: number;
  eodRateTodayPct: number;
}

export interface OwnerCompanyView {
  id: string;
  name: string;
  code: string;
  vertical: string;
  description: string;
  leadUserId: string | null;
  leadName: string | null;
  memberIds: string[];
  staffCount: number;
  initiativeCount: number;
  avgInitiativeProgress: number;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerInitiativeView {
  id: string;
  title: string;
  description: string;
  companyId: string | null;
  companyName: string | null;
  battalionId: string | null;
  battalionName: string | null;
  leadUserId: string | null;
  leadName: string | null;
  status: InitiativeStatus;
  progress: number;
  dueDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerStatusDistribution {
  onDesk: number;
  openForTask: number;
  inMeeting: number;
  onBreak: number;
  other: number;
  offline: number;
}

export interface OwnerTeamAnalytics {
  id: string;
  kind: "battalion" | "department";
  name: string;
  description: string;
  memberCount: number;
  activeMemberCount: number;
  checkedInToday: number;
  onLeaveToday: number;
  statusDistribution: OwnerStatusDistribution;
  tasksCompleted: number;
  tasksPending: number;
  tasksOverdue: number;
  eodSubmittedToday: number;
  eodComplianceRatePct: number;
  memberIds: string[];
}

export type OwnerTodayAttendanceState =
  "checked_in" | "checked_out" | "on_leave" | "not_checked_in";

export interface OwnerEmployeeAnalytics {
  id: string;
  fullName: string;
  username: string;
  email: string;
  designation: string;
  department: string;
  role: Role;
  active: boolean;
  reportingAdminId: string | null;
  reportingAdminName: string | null;
  avatarColor: string;
  avatarUrl: string | null;
  casualBalance: number;
  sickBalance: number;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  weekOffs: string[] | null;
  workMode: WorkMode;
  geoFenceMandatory: boolean;
  scheduleConfigured: boolean;
  liveStatus: string | null;
  liveAvailableFor: string | null;
  liveAvailableUntil: string | null;
  liveExpired: boolean;
  battalionIds: string[];
  battalionNames: string[];
  companyIds: string[];
  companyNames: string[];
  todayAttendanceStatus: OwnerTodayAttendanceState;
  todayPunchIn: string | null;
  todayPunchOut: string | null;
  todayLateMinutes: number;
  attendanceRatePct: number;
  daysPresent: number;
  totalTrackedDays: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksPending: number;
  tasksOverdue: number;
  eodsSubmittedTotal: number;
  eodSubmittedToday: boolean;
  recentTasks: Task[];
  recentEods: EodReport[];
  recentAttendance: AttendanceRecord[];
  recentLeaves: LeaveRequest[];
}

export interface OwnerAnalyticsResponse {
  ok: true;
  generatedAt: string;
  todayDate: string;
  kpis: OwnerKpis;
  companies: OwnerCompanyView[];
  initiatives: OwnerInitiativeView[];
  battalions: OwnerTeamAnalytics[];
  departments: OwnerTeamAnalytics[];
  employees: OwnerEmployeeAnalytics[];
}
