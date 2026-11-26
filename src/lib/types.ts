export type Role = "super_admin" | "admin" | "member";

export type WorkMode = "WFO" | "WFH" | "Hybrid";

export const WORK_MODE_VALUES = ["WFO", "WFH", "Hybrid"] as const;

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface User {
  id: string;
  fullName: string;
  username: string;
  email: string;
  designation: string;
  department: string;
  role: Role;
  reportingAdminId: string | null;
  active: boolean;
  dailyVision: string | null;
  avatarColor: string;
  /** Optional profile photo (data URL or remote URL). */
  avatarUrl?: string | null;
  casualBalance: number;
  sickBalance: number;
  /** Optional/nullable work schedule & attendance policy fields. */
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  weekOffs?: string[] | null;
  workMode?: WorkMode;
  geoFenceMandatory?: boolean;
}

export type AttendanceStatus =
  "present" | "absent" | "week_off" | "casual_leave" | "sick_leave" | "holiday";

export interface CompanyHoliday {
  id: string;
  name: string;
  date: string; // yyyy-MM-dd
  description?: string;
  mandatory?: boolean;
  createdAt?: string;
  createdBy?: string;
}

export type GeofenceStatus = "Inside Office" | "Out of Bounds" | "Bypassed";

export interface OfficeLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
}

export interface OfficeGeofenceConfig {
  enabled: boolean;
  officeName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  offices?: OfficeLocation[];
  shiftStartTime?: string; // "HH:mm"
  shiftEndTime?: string; // "HH:mm"
  lateCarryoverEnabled?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  date: string; // yyyy-MM-dd
  punchIn: string | null; // ISO
  punchOut: string | null;
  hours: number;
  status?: AttendanceStatus;
  punchInLatitude?: number | null;
  punchInLongitude?: number | null;
  punchInDistanceMeters?: number | null;
  geofenceStatus?: GeofenceStatus;
  matchedOfficeId?: string;
  matchedOfficeName?: string;
  lateMinutes?: number;
  requiredLogoutAt?: string | null;
}

export type TaskStatus =
  | "assigned"
  | "in_progress"
  | "submitted"
  | "revision_requested"
  | "rejected"
  | "approved"
  | "completed";

export type Priority = "low" | "medium" | "high" | "urgent";
export type ProofType = "image" | "file" | "link" | "any";

export interface TaskProof {
  id: string;
  type: "image" | "file" | "link" | "text";
  value: string;
  note: string;
  submittedAt: string;
}

export interface TaskComment {
  id: string;
  authorId: string;
  body: string;
  at: string;
}

export type TaskCadence = "today" | "weekly" | "monthly" | "quarterly";

export type TaskWeeklyAction = "done" | "resumed" | "rework";

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  assignedById: string;
  priority: Priority;
  status: TaskStatus;
  cadence: TaskCadence;
  startDate: string;
  dueDate: string;
  requiredProof: ProofType;
  proofs: TaskProof[];
  comments: TaskComment[];
  completedAt?: string | null;
  weeklyAction?: TaskWeeklyAction | null;
  plannedDate?: string | null;
}

export interface EodReport {
  id: string;
  userId: string;
  date: string; // yyyy-MM-dd
  worked: string; // what they worked on
  completed: string; // what they finished
  blockers: string;
  hours: number;
  taskIds: string[];
  submittedAt: string;
}

export type LeaveType = "casual" | "sick";
export type LeaveStatus = "pending" | "approved" | "rejected";

export interface LeaveRequest {
  id: string;
  userId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  reason: string;
  status: LeaveStatus;
  adminComment: string;
  emergencyContact?: string | undefined;
  createdAt: string;
}

export interface LeadDataset {
  id: string;
  name: string;
  description: string;
  source: string;
  uploadedById: string;
  uploadedAt: string;
  visibility: "public" | "private";
  locked: boolean;
  records: number;
  tags: string[];
}

export type MessageAttachmentKind = "image" | "video" | "audio" | "pdf" | "document" | "other";

export interface MessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  kind: MessageAttachmentKind;
  ext?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  at: string;
  readBy: string[];
  attachment?: MessageAttachment | null;
}

export interface Conversation {
  id: string;
  name: string;
  kind: "direct" | "group" | "announcement";
  participantIds: string[];
}

export type TicketStatus =
  "created" | "open" | "in_progress" | "waiting_employee" | "completed" | "closed";

export type TicketCategory = "platform" | "hr" | "work" | "it" | "payroll" | "other";

export interface TicketComment {
  id: string;
  authorId: string;
  body: string;
  at: string;
  internal: boolean;
}

export interface Ticket {
  id: string;
  code: string;
  subject: string;
  category: TicketCategory;
  description: string;
  priority: Priority;
  status: TicketStatus;
  createdById: string;
  ownerId: string | null;
  createdAt: string;
  comments: TicketComment[];
}

export type AwardType =
  | "Employee of the Month"
  | "Star Employee"
  | "Most Improved"
  | "Team Player"
  | "Best Attendance"
  | "Highest Task Completion"
  | "Client Champion"
  | "Innovation Award";

export interface RecognitionAward {
  id: string;
  userId: string;
  type: AwardType | string;
  period: string;
  reason: string;
  nominatedById: string;
  quote?: string | undefined;
  featured: boolean;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  href?: string | undefined;
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  detail: string;
  at: string;
}

export type Perm =
  | "manage_users"
  | "manage_admins"
  | "approve_leave"
  | "upload_leads"
  | "view_all_tickets"
  | "view_reports"
  | "view_all_eod"
  | "manage_recognition"
  | "manage_holidays"
  | "system_settings";

export interface MonthlyReview {
  id: string;
  userId: string;
  monthKey: string; // e.g. "2026-11"
  submittedAt: string;
  tasksCompletedSummary: string;
  hits: string;
  misses: string;
  futureTargets: string;
  employeeRequirements: string;
}

export type VaultCategory = "Passwords" | "Secrets" | "Credentials" | "Small Text";
export type VaultVisibility = "close" | "open";

export interface VaultItem {
  id: string;
  title: string;
  category: VaultCategory;
  creatorId: string;
  recipientId: string | null;
  visibility: VaultVisibility;
  passwordProtected: boolean;
  encryptedPayload: string;
  iv: string;
  salt: string;
  checkedByRecipient: boolean;
  createdAt: string;
  unlockedAt?: string | null;
}

export interface UserPresence {
  userId: string;
  status: string;
  isCustomStatus: boolean;
  availableFor: string;
  isCustomAvailability: boolean;
  availableFrom: string | null;
  availableUntil: string | null;
  updatedAt: string;
}

export interface Battalion {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  memberIds: string[];
  createdAt: string;
}

export interface BattalionMember {
  id: string;
  fullName: string;
  username: string;
  designation: string;
  department: string;
  role: Role;
  avatarColor: string;
  avatarUrl?: string | null;
  presence: UserPresence | null;
}

export interface PopulatedBattalion {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  memberIds: string[];
  createdAt: string;
  members: BattalionMember[];
}

export interface MomActionItem {
  id: string;
  task: string;
  owner: string;
  deadline: string;
  status: "Open" | "In Progress" | "Completed";
}

export interface MomOverlayElement {
  id: string;
  kind: "stamp" | "signature";
  assetId: string;
  label: string;
  url: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  rotation: number;
  opacity: number;
}

export interface MomBrandAsset {
  id: string;
  kind: "letterhead" | "stamp" | "signature";
  name: string;
  url: string;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
  letterheadMode?: "header" | "fullpage";
  isDefault?: boolean;
}

export interface MomDocument {
  id: string;
  title: string;
  meetingDate: string;
  meetingTime?: string;
  location?: string;
  department?: string;
  sourceType: "recording" | "upload" | "manual";
  sourceFileName?: string;
  detectedLanguage?: string;
  participants: string[];
  contentHtml: string;
  actionItems: MomActionItem[];
  verbatimTranscript?: string;
  letterheadEnabled: boolean;
  letterheadAssetId: string | null;
  letterheadMode?: "header" | "fullpage";
  overlays: MomOverlayElement[];
  visibility: "private" | "team" | "selected";
  sharedWithIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type BrandFontFamily =
  "Inter" | "Roboto" | "Open Sans" | "Poppins" | "Lato" | "Nunito" | "Raleway" | "Montserrat";

export interface PortalBrandingConfig {
  logoUrl: string | null;
  organisationName: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: BrandFontFamily;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AppState {
  users: User[];
  attendance: AttendanceRecord[];
  tasks: Task[];
  leaves: LeaveRequest[];
  leads: LeadDataset[];
  conversations: Conversation[];
  messages: Message[];
  tickets: Ticket[];
  awards: RecognitionAward[];
  notifications: AppNotification[];
  audit: AuditLog[];
  eodReports: EodReport[];
  holidays: CompanyHoliday[];
  monthlyReviews: MonthlyReview[];
  vaultItems: VaultItem[];
  officeGeofence?: OfficeGeofenceConfig;
  branding?: PortalBrandingConfig;
  userPresence?: Record<string, UserPresence>;
  battalions?: Battalion[];
  momDocuments?: MomDocument[];
  momBrandAssets?: MomBrandAsset[];
  ticketSeq: number;
  sessionUserId: string | null;
  /** Super Admin controls exactly what Admins can see and do. */
  adminPerms: Perm[];
}
