import type {
  AppState,
  Perm,
  AttendanceRecord,
  LeadDataset,
  RecognitionAward,
  EodReport,
  CompanyHoliday,
  MonthlyReview,
  VaultItem,
  UserPresence,
  Battalion,
} from "./types";
import { DEFAULT_OFFICE_GEOFENCE } from "./geofence";
import { DEFAULT_PORTAL_BRANDING } from "./branding";

export const DEFAULT_ADMIN_PERMS: Perm[] = [
  "manage_users",
  "approve_leave",
  "upload_leads",
  "view_all_tickets",
  "view_reports",
  "view_all_eod",
  "manage_holidays",
];

export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function createEmptyPortalState(): AppState {
  return {
    users: [],
    attendance: [] as AttendanceRecord[],
    tasks: [],
    leaves: [],
    leads: [] as LeadDataset[],
    conversations: [],
    messages: [],
    tickets: [],
    awards: [] as RecognitionAward[],
    notifications: [],
    audit: [],
    eodReports: [] as EodReport[],
    holidays: [] as CompanyHoliday[],
    monthlyReviews: [] as MonthlyReview[],
    vaultItems: [] as VaultItem[],
    officeGeofence: { ...DEFAULT_OFFICE_GEOFENCE },
    branding: { ...DEFAULT_PORTAL_BRANDING },
    userPresence: {} as Record<string, UserPresence>,
    battalions: [] as Battalion[],
    ticketSeq: 1000,
    sessionUserId: null,
    adminPerms: DEFAULT_ADMIN_PERMS,
  };
}
