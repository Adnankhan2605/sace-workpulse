import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { assertPersistentStorageReady, db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { isUserScheduleConfigured } from "./accounts.schemas.ts";
import { ensurePortalInitialized, stripCredentialsFromUsers, toPublicUser } from "./auth.server.ts";
import { isPresenceExpired } from "./battalion.ts";
import { DEFAULT_OFFICE_GEOFENCE, calculateShiftScheduleForPunchIn } from "./geofence.ts";
import {
  CreateCompanySchema,
  CreateInitiativeSchema,
  INITIATIVE_STATUS_VALUES,
  UpdateCompanySchema,
  UpdateInitiativeSchema,
  type CreateCompanyInput,
  type CreateInitiativeInput,
  type InitiativeStatus,
  type OwnerAnalyticsResponse,
  type OwnerCompanyView,
  type OwnerEmployeeAnalytics,
  type OwnerInitiativeView,
  type OwnerKpis,
  type OwnerStatusDistribution,
  type OwnerTeamAnalytics,
  type OwnerTodayAttendanceState,
  type UpdateCompanyInput,
  type UpdateInitiativeInput,
} from "./owner.schemas.ts";
import { assertRateLimit } from "./rate-limit.server.ts";
import { createSeedState, dateKey } from "./seed.ts";
import type {
  AppState,
  AttendanceRecord,
  AuditLog,
  Battalion,
  EodReport,
  LeaveRequest,
  OfficeGeofenceConfig,
  Role,
  Task,
  User,
  UserPresence,
} from "./types.ts";

const PORTAL_STATE_ID = "current_state";
const HIDDEN_SYSTEM_EMAIL = "superadmin@sace.com";
const HIDDEN_SYSTEM_ID = "u-superadmin";

function assertSuperAdminCaller(role: Role): void {
  if (role !== "super_admin") {
    throw new Error("Forbidden: Owner's Executive Dashboard is restricted to Super Admin only.");
  }
}

export function isHiddenSystemAccount(user: {
  id?: string | null;
  email?: string | null;
  username?: string | null;
}): boolean {
  const email = (user.email ?? "").trim().toLowerCase();
  const username = (user.username ?? "").trim().toLowerCase();
  return (
    user.id === HIDDEN_SYSTEM_ID ||
    email === HIDDEN_SYSTEM_EMAIL ||
    username === HIDDEN_SYSTEM_EMAIL
  );
}

function isCompletedTaskStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "approved";
}

function isTaskOverdue(task: Task, todayStr: string): boolean {
  if (!task || isCompletedTaskStatus(task.status)) return false;
  const due = (task.dueDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  return due < todayStr;
}

function isValidInitiativeStatus(val: string | null | undefined): val is InitiativeStatus {
  return INITIATIVE_STATUS_VALUES.includes(val as InitiativeStatus);
}

function resolveLateMinutes(
  rec: AttendanceRecord | undefined,
  officeGeofence: AppState["officeGeofence"],
  user?: Pick<User, "shiftStartTime" | "shiftEndTime">,
): number {
  if (!rec) return 0;
  if (typeof rec.lateMinutes === "number" && Number.isFinite(rec.lateMinutes)) {
    return Math.max(0, rec.lateMinutes);
  }
  if (!rec.punchIn) return 0;
  const parsed = new Date(rec.punchIn);
  if (Number.isNaN(parsed.getTime())) return 0;
  const baseCfg = officeGeofence ?? DEFAULT_OFFICE_GEOFENCE;
  const effectiveCfg: OfficeGeofenceConfig =
    user?.shiftStartTime || user?.shiftEndTime
      ? {
          ...baseCfg,
          shiftStartTime:
            user.shiftStartTime ??
            baseCfg.shiftStartTime ??
            DEFAULT_OFFICE_GEOFENCE.shiftStartTime ??
            "09:30",
          shiftEndTime:
            user.shiftEndTime ??
            baseCfg.shiftEndTime ??
            DEFAULT_OFFICE_GEOFENCE.shiftEndTime ??
            "18:30",
        }
      : baseCfg;
  return calculateShiftScheduleForPunchIn(parsed, effectiveCfg).lateMinutes;
}

function tallyPresenceIntoDistribution(
  dist: OwnerStatusDistribution,
  presence: UserPresence | null | undefined,
  nowMs: number,
): void {
  if (!presence || isPresenceExpired(presence, nowMs)) {
    dist.offline += 1;
    return;
  }
  const s = (presence.status ?? "").trim();
  if (s === "On Desk") {
    dist.onDesk += 1;
  } else if (s === "Open for Task") {
    dist.openForTask += 1;
  } else if (s === "In Meeting" || s === "In 1o1") {
    dist.inMeeting += 1;
  } else if (s === "Break") {
    dist.onBreak += 1;
  } else {
    dist.other += 1;
  }
}

async function appendOwnerAudit(actorId: string, action: string, detail: string): Promise<void> {
  try {
    const [stateRows, userRows] = await Promise.all([
      db
        .select()
        .from(schema.portalState)
        .where(eq(schema.portalState.id, PORTAL_STATE_ID))
        .limit(1),
      db.select().from(schema.users),
    ]);
    const existing = (stateRows[0]?.data as AppState | undefined) ?? createSeedState();
    const publicUsers = stripCredentialsFromUsers(userRows.map(toPublicUser));
    const entry: AuditLog = {
      id: `aud-${crypto.randomUUID().slice(0, 10)}`,
      actorId,
      action,
      detail,
      at: new Date().toISOString(),
    };
    const nextState: AppState = {
      ...existing,
      users: publicUsers,
      audit: [entry, ...(existing.audit ?? [])].slice(0, 5000),
      sessionUserId: null,
    };
    await db
      .insert(schema.portalState)
      .values({ id: PORTAL_STATE_ID, data: nextState })
      .onConflictDoUpdate({
        target: schema.portalState.id,
        set: { data: nextState, updatedAt: new Date() },
      });
  } catch (err) {
    console.warn("[Owner Dashboard] Audit append skipped:", err);
  }
}

function mapCompanyRow(
  row: typeof schema.companies.$inferSelect,
  userById: Map<string, User>,
  visibleUserIds: Set<string>,
  initiativesByCompany: Map<string, Array<typeof schema.initiatives.$inferSelect>>,
): OwnerCompanyView {
  const rawMembers = Array.isArray(row.memberIds) ? row.memberIds : [];
  const memberIds = Array.from(new Set(rawMembers.filter((id) => visibleUserIds.has(id))));
  const linkedInitiatives = initiativesByCompany.get(row.id) ?? [];
  const avgInitiativeProgress =
    linkedInitiatives.length > 0
      ? Math.round(
          linkedInitiatives.reduce((sum, item) => sum + (Number(item.progress) || 0), 0) /
            linkedInitiatives.length,
        )
      : 0;
  const lead = row.leadUserId ? userById.get(row.leadUserId) : undefined;

  return {
    id: row.id,
    name: row.name,
    code: row.code ?? "",
    vertical: row.vertical ?? "",
    description: row.description ?? "",
    leadUserId: lead ? lead.id : (row.leadUserId ?? null),
    leadName: lead?.fullName ?? null,
    memberIds,
    staffCount: memberIds.length,
    initiativeCount: linkedInitiatives.length,
    avgInitiativeProgress,
    active: row.active !== false,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapInitiativeRow(
  row: typeof schema.initiatives.$inferSelect,
  companyById: Map<string, typeof schema.companies.$inferSelect>,
  battalionById: Map<string, Battalion>,
  userById: Map<string, User>,
): OwnerInitiativeView {
  const company = row.companyId ? companyById.get(row.companyId) : undefined;
  const battalion = row.battalionId ? battalionById.get(row.battalionId) : undefined;
  const lead = row.leadUserId ? userById.get(row.leadUserId) : undefined;
  const status: InitiativeStatus = isValidInitiativeStatus(row.status) ? row.status : "on_track";
  const progress = Math.max(0, Math.min(100, Math.round(Number(row.progress) || 0)));

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    companyId: company ? company.id : (row.companyId ?? null),
    companyName: company?.name ?? null,
    battalionId: battalion ? battalion.id : (row.battalionId ?? null),
    battalionName: battalion?.name ?? null,
    leadUserId: lead ? lead.id : (row.leadUserId ?? null),
    leadName: lead?.fullName ?? null,
    status,
    progress,
    dueDate: row.dueDate || null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getOwnerAnalyticsRecord(
  callerId: string,
  callerRole: Role,
): Promise<OwnerAnalyticsResponse> {
  assertSuperAdminCaller(callerRole);
  assertRateLimit(`owner-analytics:${callerId}`, { limit: 120, windowMs: 60_000 });
  await ensurePortalInitialized();

  const [stateRows, userRows, companyRows, initiativeRows] = await Promise.all([
    db.select().from(schema.portalState).where(eq(schema.portalState.id, PORTAL_STATE_ID)).limit(1),
    db.select().from(schema.users),
    db.select().from(schema.companies),
    db.select().from(schema.initiatives),
  ]);

  const portalState = (stateRows[0]?.data as AppState | undefined) ?? createSeedState();
  const allPublicUsers = userRows.map(toPublicUser);

  // Strictly exclude hidden system accounts (like superadmin@sace.com)
  const visibleUsers = allPublicUsers.filter((u) => !isHiddenSystemAccount(u));
  const visibleUserById = new Map(visibleUsers.map((u) => [u.id, u]));
  const visibleUserIds = new Set(visibleUsers.map((u) => u.id));
  const activeUsers = visibleUsers.filter((u) => u.active !== false);

  const now = new Date();
  const nowMs = now.getTime();
  const todayStr = dateKey(now);

  // Guard all portal arrays against null/undefined
  const rawAttendance = Array.isArray(portalState.attendance) ? portalState.attendance : [];
  const rawTasks = Array.isArray(portalState.tasks) ? portalState.tasks : [];
  const rawEods = Array.isArray(portalState.eodReports) ? portalState.eodReports : [];
  const rawLeaves = Array.isArray(portalState.leaves) ? portalState.leaves : [];
  const rawBattalions = Array.isArray(portalState.battalions) ? portalState.battalions : [];
  const presenceMap =
    portalState.userPresence && typeof portalState.userPresence === "object"
      ? portalState.userPresence
      : {};

  // Filter records to visible users only
  const visibleAttendance = rawAttendance.filter((a) => a && visibleUserIds.has(a.userId));
  const visibleTasks = rawTasks.filter((t) => t && visibleUserIds.has(t.assigneeId));
  const visibleEods = rawEods.filter((r) => r && visibleUserIds.has(r.userId));
  const visibleLeaves = rawLeaves.filter((l) => l && visibleUserIds.has(l.userId));

  // Track unique dates seen in attendance/EOD so attendance % has a meaningful denominator
  const trackedDatesSet = new Set<string>();
  trackedDatesSet.add(todayStr);
  for (const rec of visibleAttendance) {
    if (rec.date && rec.date <= todayStr) trackedDatesSet.add(rec.date);
  }
  const trackedDatesCount = Math.max(1, Math.min(30, trackedDatesSet.size));

  // Index records per user
  const attendanceByUser = new Map<string, AttendanceRecord[]>();
  for (const rec of visibleAttendance) {
    const list = attendanceByUser.get(rec.userId) ?? [];
    list.push(rec);
    attendanceByUser.set(rec.userId, list);
  }

  const tasksByUser = new Map<string, Task[]>();
  for (const task of visibleTasks) {
    const list = tasksByUser.get(task.assigneeId) ?? [];
    list.push(task);
    tasksByUser.set(task.assigneeId, list);
  }

  const eodsByUser = new Map<string, EodReport[]>();
  for (const eod of visibleEods) {
    const list = eodsByUser.get(eod.userId) ?? [];
    list.push(eod);
    eodsByUser.set(eod.userId, list);
  }

  const leavesByUser = new Map<string, LeaveRequest[]>();
  for (const lv of visibleLeaves) {
    const list = leavesByUser.get(lv.userId) ?? [];
    list.push(lv);
    leavesByUser.set(lv.userId, list);
  }

  // Sort companies & initiatives cleanly in JS
  const sortedCompanyRows = [...companyRows].sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || ""),
  );
  const sortedInitiativeRows = [...initiativeRows].sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || ""),
  );

  const companyById = new Map(sortedCompanyRows.map((c) => [c.id, c]));
  const battalionById = new Map(rawBattalions.map((b) => [b.id, b]));
  const initiativesByCompany = new Map<string, Array<typeof schema.initiatives.$inferSelect>>();
  for (const init of sortedInitiativeRows) {
    if (init.companyId) {
      const list = initiativesByCompany.get(init.companyId) ?? [];
      list.push(init);
      initiativesByCompany.set(init.companyId, list);
    }
  }

  const companies: OwnerCompanyView[] = sortedCompanyRows.map((row) =>
    mapCompanyRow(row, visibleUserById, visibleUserIds, initiativesByCompany),
  );
  const initiatives: OwnerInitiativeView[] = sortedInitiativeRows.map((row) =>
    mapInitiativeRow(row, companyById, battalionById, visibleUserById),
  );

  // Build user -> companies & user -> battalions lookups
  const userBattalions = new Map<string, Battalion[]>();
  for (const b of rawBattalions) {
    const memberIds = Array.isArray(b.memberIds) ? b.memberIds : [];
    for (const uid of memberIds) {
      if (!visibleUserIds.has(uid)) continue;
      const list = userBattalions.get(uid) ?? [];
      list.push(b);
      userBattalions.set(uid, list);
    }
  }

  const userCompanies = new Map<string, OwnerCompanyView[]>();
  for (const c of companies) {
    for (const uid of c.memberIds) {
      const list = userCompanies.get(uid) ?? [];
      list.push(c);
      userCompanies.set(uid, list);
    }
  }

  // Compute per-employee analytics
  let checkedInTodayCount = 0;
  let checkedOutTodayCount = 0;
  let onLeaveTodayCount = 0;
  let lateTodayCount = 0;
  let notCheckedInCount = 0;
  let eodsSubmittedToday = 0;

  const employees: OwnerEmployeeAnalytics[] = visibleUsers
    .map((u): OwnerEmployeeAnalytics => {
      const userAtt = [...(attendanceByUser.get(u.id) ?? [])].sort((a, b) =>
        (b.date || "").localeCompare(a.date || ""),
      );
      const userTasks = [...(tasksByUser.get(u.id) ?? [])].sort((a, b) =>
        (b.dueDate || "").localeCompare(a.dueDate || ""),
      );
      const userEods = [...(eodsByUser.get(u.id) ?? [])].sort((a, b) =>
        (b.submittedAt || b.date || "").localeCompare(a.submittedAt || a.date || ""),
      );
      const userLeaves = [...(leavesByUser.get(u.id) ?? [])].sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || ""),
      );

      const todayAtt = userAtt.find((a) => a.date === todayStr);
      const approvedLeaveToday = userLeaves.find(
        (l) => l.status === "approved" && l.startDate <= todayStr && l.endDate >= todayStr,
      );

      let todayAttendanceStatus: OwnerTodayAttendanceState = "not_checked_in";
      if (todayAtt?.punchIn && todayAtt?.punchOut) {
        todayAttendanceStatus = "checked_out";
      } else if (todayAtt?.punchIn) {
        todayAttendanceStatus = "checked_in";
      } else if (approvedLeaveToday) {
        todayAttendanceStatus = "on_leave";
      }

      const todayLateMinutes = resolveLateMinutes(todayAtt, portalState.officeGeofence, u);

      if (u.active !== false) {
        if (todayAttendanceStatus === "checked_in") {
          checkedInTodayCount += 1;
        } else if (todayAttendanceStatus === "checked_out") {
          checkedInTodayCount += 1;
          checkedOutTodayCount += 1;
        } else if (todayAttendanceStatus === "on_leave") {
          onLeaveTodayCount += 1;
        } else {
          notCheckedInCount += 1;
        }
        if (todayLateMinutes > 0 && todayAtt?.punchIn) {
          lateTodayCount += 1;
        }
      }

      const presentDates = new Set(
        userAtt
          .filter((a) => Boolean(a.punchIn) || a.status === "present")
          .map((a) => a.date)
          .filter(Boolean),
      );
      const daysPresent = presentDates.size;
      const attendanceRatePct =
        trackedDatesCount > 0
          ? Math.min(100, Math.round((daysPresent / trackedDatesCount) * 100))
          : 0;

      const tasksCompleted = userTasks.filter((t) => isCompletedTaskStatus(t.status)).length;
      const tasksOverdue = userTasks.filter((t) => isTaskOverdue(t, todayStr)).length;
      const tasksPending = Math.max(0, userTasks.length - tasksCompleted);

      const eodSubmittedToday = userEods.some((r) => r.date === todayStr);
      if (u.active !== false && eodSubmittedToday) {
        eodsSubmittedToday += 1;
      }

      const presence = presenceMap[u.id] ?? null;
      const expired = isPresenceExpired(presence, nowMs);
      const assignedBattalions = userBattalions.get(u.id) ?? [];
      const assignedCompanies = userCompanies.get(u.id) ?? [];
      const reportingAdmin = u.reportingAdminId
        ? visibleUserById.get(u.reportingAdminId)
        : undefined;

      return {
        id: u.id,
        fullName: u.fullName,
        username: u.username,
        email: u.email,
        designation: u.designation || "Team Member",
        department: u.department || "General",
        role: u.role,
        active: u.active !== false,
        reportingAdminId: u.reportingAdminId ?? null,
        reportingAdminName: reportingAdmin?.fullName ?? null,
        avatarColor: u.avatarColor || "#5B00A3",
        avatarUrl: u.avatarUrl ?? null,
        casualBalance: Number(u.casualBalance ?? 12),
        sickBalance: Number(u.sickBalance ?? 12),
        shiftStartTime: u.shiftStartTime ?? null,
        shiftEndTime: u.shiftEndTime ?? null,
        weekOffs: Array.isArray(u.weekOffs) ? u.weekOffs : null,
        workMode: u.workMode ?? "WFO",
        geoFenceMandatory: u.geoFenceMandatory ?? true,
        scheduleConfigured: isUserScheduleConfigured(u),
        liveStatus: presence?.status ?? null,
        liveAvailableFor: presence?.availableFor ?? null,
        liveAvailableUntil: presence?.availableUntil ?? null,
        liveExpired: presence ? expired : true,
        battalionIds: assignedBattalions.map((b) => b.id),
        battalionNames: assignedBattalions.map((b) => b.name),
        companyIds: assignedCompanies.map((c) => c.id),
        companyNames: assignedCompanies.map((c) => c.name),
        todayAttendanceStatus,
        todayPunchIn: todayAtt?.punchIn ?? null,
        todayPunchOut: todayAtt?.punchOut ?? null,
        todayLateMinutes,
        attendanceRatePct,
        daysPresent,
        totalTrackedDays: trackedDatesCount,
        tasksTotal: userTasks.length,
        tasksCompleted,
        tasksPending,
        tasksOverdue,
        eodsSubmittedTotal: userEods.length,
        eodSubmittedToday,
        recentTasks: userTasks.slice(0, 40),
        recentEods: userEods.slice(0, 20),
        recentAttendance: userAtt.slice(0, 30),
        recentLeaves: userLeaves.slice(0, 20),
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const employeeById = new Map(employees.map((e) => [e.id, e]));

  function buildTeamAnalytics(
    id: string,
    kind: "battalion" | "department",
    name: string,
    description: string,
    memberIds: string[],
  ): OwnerTeamAnalytics {
    const validMembers = memberIds
      .map((mid) => employeeById.get(mid))
      .filter((m): m is OwnerEmployeeAnalytics => Boolean(m));
    const activeMembers = validMembers.filter((m) => m.active);
    const statusDistribution: OwnerStatusDistribution = {
      onDesk: 0,
      openForTask: 0,
      inMeeting: 0,
      onBreak: 0,
      other: 0,
      offline: 0,
    };

    let teamCheckedIn = 0;
    let teamOnLeave = 0;
    let teamTasksCompleted = 0;
    let teamTasksPending = 0;
    let teamTasksOverdue = 0;
    let teamEodToday = 0;

    for (const m of validMembers) {
      tallyPresenceIntoDistribution(statusDistribution, presenceMap[m.id], nowMs);
      if (m.todayAttendanceStatus === "checked_in" || m.todayAttendanceStatus === "checked_out") {
        teamCheckedIn += 1;
      } else if (m.todayAttendanceStatus === "on_leave") {
        teamOnLeave += 1;
      }
      teamTasksCompleted += m.tasksCompleted;
      teamTasksPending += m.tasksPending;
      teamTasksOverdue += m.tasksOverdue;
      if (m.active && m.eodSubmittedToday) {
        teamEodToday += 1;
      }
    }

    const eodDenominator = teamCheckedIn > 0 ? teamCheckedIn : activeMembers.length;
    const eodComplianceRatePct =
      eodDenominator > 0 ? Math.min(100, Math.round((teamEodToday / eodDenominator) * 100)) : 0;

    return {
      id,
      kind,
      name,
      description,
      memberCount: validMembers.length,
      activeMemberCount: activeMembers.length,
      checkedInToday: teamCheckedIn,
      onLeaveToday: teamOnLeave,
      statusDistribution,
      tasksCompleted: teamTasksCompleted,
      tasksPending: teamTasksPending,
      tasksOverdue: teamTasksOverdue,
      eodSubmittedToday: teamEodToday,
      eodComplianceRatePct,
      memberIds: validMembers.map((m) => m.id),
    };
  }

  const battalions: OwnerTeamAnalytics[] = rawBattalions.map((b) => {
    const uniqueIds = Array.from(
      new Set(
        (Array.isArray(b.memberIds) ? b.memberIds : []).filter((id) => visibleUserIds.has(id)),
      ),
    );
    return buildTeamAnalytics(
      b.id,
      "battalion",
      b.name || "Unnamed Battalion",
      b.description || "",
      uniqueIds,
    );
  });

  const deptGroups = new Map<string, string[]>();
  for (const emp of employees) {
    const deptName = (emp.department || "General").trim() || "General";
    const list = deptGroups.get(deptName) ?? [];
    list.push(emp.id);
    deptGroups.set(deptName, list);
  }
  const departments: OwnerTeamAnalytics[] = Array.from(deptGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([deptName, memberIds]) =>
      buildTeamAnalytics(
        `dept-${deptName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        "department",
        deptName,
        `${memberIds.length} member(s) in ${deptName}`,
        memberIds,
      ),
    );

  // Aggregate Top Executive KPIs
  const activeCompanies = companies.filter((c) => c.active);
  const assignedStaffSet = new Set<string>();
  for (const c of activeCompanies) {
    for (const mid of c.memberIds) {
      assignedStaffSet.add(mid);
    }
  }

  const activeInitiativesList = initiatives.filter((i) => i.status !== "completed");
  const completedInitiativesList = initiatives.filter((i) => i.status === "completed");
  const atRiskInitiativesList = initiatives.filter((i) => i.status === "at_risk");
  const overallInitiativeCompletionPct =
    initiatives.length > 0
      ? Math.round(initiatives.reduce((sum, item) => sum + item.progress, 0) / initiatives.length)
      : 0;

  const tasksTotal = visibleTasks.length;
  const tasksCompleted = visibleTasks.filter((t) => isCompletedTaskStatus(t.status)).length;
  const tasksOverdue = visibleTasks.filter((t) => isTaskOverdue(t, todayStr)).length;
  const tasksPending = Math.max(0, tasksTotal - tasksCompleted);
  const taskCompletionRatePct =
    tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;

  const activeStaffCount = activeUsers.length;
  const attendanceRateTodayPct =
    activeStaffCount > 0
      ? Math.min(100, Math.round((checkedInTodayCount / activeStaffCount) * 100))
      : 0;

  const eodExpectedToday = checkedInTodayCount > 0 ? checkedInTodayCount : activeStaffCount;
  const eodRateTodayPct =
    eodExpectedToday > 0
      ? Math.min(100, Math.round((eodsSubmittedToday / eodExpectedToday) * 100))
      : 0;

  const kpis: OwnerKpis = {
    totalCompanies: companies.length,
    activeCompanies: activeCompanies.length,
    totalAssignedCompanyStaff: assignedStaffSet.size,
    totalInitiatives: initiatives.length,
    activeInitiatives: activeInitiativesList.length,
    completedInitiatives: completedInitiativesList.length,
    atRiskInitiatives: atRiskInitiativesList.length,
    overallInitiativeCompletionPct,
    totalVisibleUsers: visibleUsers.length,
    activeStaffCount,
    checkedInTodayCount,
    checkedOutTodayCount,
    onLeaveTodayCount,
    lateTodayCount,
    notCheckedInCount,
    attendanceRateTodayPct,
    tasksTotal,
    tasksCompleted,
    tasksPending,
    tasksOverdue,
    taskCompletionRatePct,
    eodsSubmittedToday,
    eodExpectedToday,
    eodRateTodayPct,
  };

  return {
    ok: true,
    generatedAt: now.toISOString(),
    todayDate: todayStr,
    kpis,
    companies,
    initiatives,
    battalions,
    departments,
    employees,
  };
}

export async function createCompanyRecord(
  callerId: string,
  callerRole: Role,
  rawInput: CreateCompanyInput | unknown,
): Promise<{ ok: true; company: OwnerCompanyView }> {
  assertSuperAdminCaller(callerRole);
  assertRateLimit(`owner-company-write:${callerId}`, { limit: 40, windowMs: 60_000 });
  const data = CreateCompanySchema.parse(rawInput);

  await assertPersistentStorageReady();
  await ensurePortalInitialized();

  const allUsers = (await db.select().from(schema.users))
    .map(toPublicUser)
    .filter((u) => !isHiddenSystemAccount(u));
  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const visibleUserIds = new Set(allUsers.map((u) => u.id));

  const cleanMemberIds = Array.from(
    new Set((data.memberIds ?? []).filter((id) => visibleUserIds.has(id))),
  );
  const cleanLeadId =
    data.leadUserId && visibleUserIds.has(data.leadUserId) ? data.leadUserId : null;

  const nowIso = new Date().toISOString();
  const id = `cmp-${crypto.randomUUID().slice(0, 10)}`;

  await db.insert(schema.companies).values({
    id,
    name: data.name,
    code: data.code ?? "",
    vertical: data.vertical ?? "",
    description: data.description ?? "",
    leadUserId: cleanLeadId,
    memberIds: cleanMemberIds,
    active: data.active ?? true,
    createdBy: callerId,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  await appendOwnerAudit(callerId, "company_created", `Created company "${data.name}".`);

  const rows = await db.select().from(schema.companies).where(eq(schema.companies.id, id)).limit(1);
  if (!rows[0]) {
    throw new Error("Company could not be verified in the database.");
  }

  return {
    ok: true,
    company: mapCompanyRow(rows[0], userById, visibleUserIds, new Map()),
  };
}

export async function updateCompanyRecord(
  callerId: string,
  callerRole: Role,
  companyId: string,
  rawInput: UpdateCompanyInput | unknown,
): Promise<{ ok: true; company: OwnerCompanyView }> {
  assertSuperAdminCaller(callerRole);
  assertRateLimit(`owner-company-write:${callerId}`, { limit: 40, windowMs: 60_000 });
  const cleanId = companyId.trim();
  if (!cleanId) throw new Error("Company ID is required.");
  const data = UpdateCompanySchema.parse(rawInput);

  await assertPersistentStorageReady();
  await ensurePortalInitialized();

  const existingRows = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, cleanId))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Company not found.");
  }

  const [userRows, initRows] = await Promise.all([
    db.select().from(schema.users),
    db.select().from(schema.initiatives),
  ]);
  const allUsers = userRows.map(toPublicUser).filter((u) => !isHiddenSystemAccount(u));
  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const visibleUserIds = new Set(allUsers.map((u) => u.id));

  const patch: Partial<typeof schema.companies.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (data.name !== undefined) patch.name = data.name;
  if (data.code !== undefined) patch.code = data.code;
  if (data.vertical !== undefined) patch.vertical = data.vertical;
  if (data.description !== undefined) patch.description = data.description;
  if (data.active !== undefined) patch.active = data.active;
  if (data.leadUserId !== undefined) {
    patch.leadUserId =
      data.leadUserId && visibleUserIds.has(data.leadUserId) ? data.leadUserId : null;
  }
  if (data.memberIds !== undefined) {
    patch.memberIds = Array.from(new Set(data.memberIds.filter((id) => visibleUserIds.has(id))));
  }

  await db.update(schema.companies).set(patch).where(eq(schema.companies.id, cleanId));
  await appendOwnerAudit(
    callerId,
    "company_updated",
    `Updated company "${patch.name ?? existing.name}".`,
  );

  const updatedRows = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, cleanId))
    .limit(1);
  const initiativesByCompany = new Map<string, Array<typeof schema.initiatives.$inferSelect>>();
  for (const init of initRows) {
    if (init.companyId === cleanId) {
      const list = initiativesByCompany.get(cleanId) ?? [];
      list.push(init);
      initiativesByCompany.set(cleanId, list);
    }
  }

  return {
    ok: true,
    company: mapCompanyRow(
      updatedRows[0] ?? existing,
      userById,
      visibleUserIds,
      initiativesByCompany,
    ),
  };
}

export async function deleteCompanyRecord(
  callerId: string,
  callerRole: Role,
  companyId: string,
): Promise<{ ok: true; deletedId: string }> {
  assertSuperAdminCaller(callerRole);
  assertRateLimit(`owner-company-write:${callerId}`, { limit: 30, windowMs: 60_000 });
  const cleanId = companyId.trim();
  if (!cleanId) throw new Error("Company ID is required.");

  await assertPersistentStorageReady();
  await ensurePortalInitialized();

  const existingRows = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, cleanId))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Company not found.");
  }

  await db.delete(schema.companies).where(eq(schema.companies.id, cleanId));
  await db
    .update(schema.initiatives)
    .set({ companyId: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.initiatives.companyId, cleanId));

  await appendOwnerAudit(callerId, "company_deleted", `Deleted company "${existing.name}".`);

  return { ok: true, deletedId: cleanId };
}

export async function createInitiativeRecord(
  callerId: string,
  callerRole: Role,
  rawInput: CreateInitiativeInput | unknown,
): Promise<{ ok: true; initiative: OwnerInitiativeView }> {
  assertSuperAdminCaller(callerRole);
  assertRateLimit(`owner-initiative-write:${callerId}`, { limit: 40, windowMs: 60_000 });
  const data = CreateInitiativeSchema.parse(rawInput);

  await assertPersistentStorageReady();
  await ensurePortalInitialized();

  const [stateRows, userRows, companyRows] = await Promise.all([
    db.select().from(schema.portalState).where(eq(schema.portalState.id, PORTAL_STATE_ID)).limit(1),
    db.select().from(schema.users),
    db.select().from(schema.companies),
  ]);

  const portalState = (stateRows[0]?.data as AppState | undefined) ?? createSeedState();
  const allUsers = userRows.map(toPublicUser).filter((u) => !isHiddenSystemAccount(u));
  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const companyById = new Map(companyRows.map((c) => [c.id, c]));
  const battalionById = new Map((portalState.battalions ?? []).map((b) => [b.id, b]));

  const cleanCompanyId = data.companyId && companyById.has(data.companyId) ? data.companyId : null;
  const cleanBattalionId =
    data.battalionId && battalionById.has(data.battalionId) ? data.battalionId : null;
  const cleanLeadId = data.leadUserId && userById.has(data.leadUserId) ? data.leadUserId : null;

  const progress =
    data.status === "completed" ? 100 : Math.max(0, Math.min(100, data.progress ?? 0));
  const nowIso = new Date().toISOString();
  const id = `ini-${crypto.randomUUID().slice(0, 10)}`;

  await db.insert(schema.initiatives).values({
    id,
    title: data.title,
    description: data.description ?? "",
    companyId: cleanCompanyId,
    battalionId: cleanBattalionId,
    leadUserId: cleanLeadId,
    status: data.status,
    progress,
    dueDate: data.dueDate?.trim() || null,
    createdBy: callerId,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  await appendOwnerAudit(callerId, "initiative_created", `Created initiative "${data.title}".`);

  const rows = await db
    .select()
    .from(schema.initiatives)
    .where(eq(schema.initiatives.id, id))
    .limit(1);
  if (!rows[0]) {
    throw new Error("Initiative could not be verified in the database.");
  }

  return {
    ok: true,
    initiative: mapInitiativeRow(rows[0], companyById, battalionById, userById),
  };
}

export async function updateInitiativeRecord(
  callerId: string,
  callerRole: Role,
  initiativeId: string,
  rawInput: UpdateInitiativeInput | unknown,
): Promise<{ ok: true; initiative: OwnerInitiativeView }> {
  assertSuperAdminCaller(callerRole);
  assertRateLimit(`owner-initiative-write:${callerId}`, { limit: 40, windowMs: 60_000 });
  const cleanId = initiativeId.trim();
  if (!cleanId) throw new Error("Initiative ID is required.");
  const data = UpdateInitiativeSchema.parse(rawInput);

  await assertPersistentStorageReady();
  await ensurePortalInitialized();

  const existingRows = await db
    .select()
    .from(schema.initiatives)
    .where(eq(schema.initiatives.id, cleanId))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Initiative not found.");
  }

  const [stateRows, userRows, companyRows] = await Promise.all([
    db.select().from(schema.portalState).where(eq(schema.portalState.id, PORTAL_STATE_ID)).limit(1),
    db.select().from(schema.users),
    db.select().from(schema.companies),
  ]);

  const portalState = (stateRows[0]?.data as AppState | undefined) ?? createSeedState();
  const allUsers = userRows.map(toPublicUser).filter((u) => !isHiddenSystemAccount(u));
  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const companyById = new Map(companyRows.map((c) => [c.id, c]));
  const battalionById = new Map((portalState.battalions ?? []).map((b) => [b.id, b]));

  const patch: Partial<typeof schema.initiatives.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.companyId !== undefined) {
    patch.companyId = data.companyId && companyById.has(data.companyId) ? data.companyId : null;
  }
  if (data.battalionId !== undefined) {
    patch.battalionId =
      data.battalionId && battalionById.has(data.battalionId) ? data.battalionId : null;
  }
  if (data.leadUserId !== undefined) {
    patch.leadUserId = data.leadUserId && userById.has(data.leadUserId) ? data.leadUserId : null;
  }
  if (data.status !== undefined) {
    patch.status = data.status;
    if (data.status === "completed" && data.progress === undefined) {
      patch.progress = 100;
    }
  }
  if (data.progress !== undefined) {
    patch.progress = Math.max(0, Math.min(100, data.progress));
  }
  if (data.dueDate !== undefined) {
    patch.dueDate = data.dueDate?.trim() || null;
  }

  await db.update(schema.initiatives).set(patch).where(eq(schema.initiatives.id, cleanId));
  await appendOwnerAudit(
    callerId,
    "initiative_updated",
    `Updated initiative "${patch.title ?? existing.title}".`,
  );

  const updatedRows = await db
    .select()
    .from(schema.initiatives)
    .where(eq(schema.initiatives.id, cleanId))
    .limit(1);

  return {
    ok: true,
    initiative: mapInitiativeRow(updatedRows[0] ?? existing, companyById, battalionById, userById),
  };
}

export async function deleteInitiativeRecord(
  callerId: string,
  callerRole: Role,
  initiativeId: string,
): Promise<{ ok: true; deletedId: string }> {
  assertSuperAdminCaller(callerRole);
  assertRateLimit(`owner-initiative-write:${callerId}`, { limit: 30, windowMs: 60_000 });
  const cleanId = initiativeId.trim();
  if (!cleanId) throw new Error("Initiative ID is required.");

  await assertPersistentStorageReady();
  await ensurePortalInitialized();

  const existingRows = await db
    .select()
    .from(schema.initiatives)
    .where(eq(schema.initiatives.id, cleanId))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Initiative not found.");
  }

  await db.delete(schema.initiatives).where(eq(schema.initiatives.id, cleanId));
  await appendOwnerAudit(callerId, "initiative_deleted", `Deleted initiative "${existing.title}".`);

  return { ok: true, deletedId: cleanId };
}
