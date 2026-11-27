import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import {
  createSignedToken,
  stripCredentialsFromUsers,
  toPublicUser,
  verifySignedToken,
} from "./auth.server.ts";
import { createEmptyPortalState } from "./seed.ts";
import { sendPortalMailAndTeamsAlert } from "./smtp.server.ts";
import type {
  AppNotification,
  AppState,
  AttendanceRecord,
  AuditLog,
  EodReport,
  LeaveRequest,
  User,
} from "./types.ts";

const PORTAL_STATE_ID = "current_state";

declare global {
  var _sentDailyEodSignatures: Map<string, string> | undefined;
}

function getSentEodSignatureMap(): Map<string, string> {
  if (!global._sentDailyEodSignatures) {
    global._sentDailyEodSignatures = new Map();
  }
  return global._sentDailyEodSignatures;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatReadableTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function countLeaveDays(leave: LeaveRequest): number {
  if (leave.halfDay) return 0.5;
  const start = new Date(leave.startDate).getTime();
  const end = new Date(leave.endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export function createLeaveEmailActionToken(
  leaveId: string,
  decision: "approved" | "rejected",
): string {
  return createSignedToken(`leave-decision:${leaveId}:${decision}`);
}

export function verifyLeaveEmailActionToken(
  token: string,
  leaveId: string,
  decision: "approved" | "rejected",
): boolean {
  const subject = verifySignedToken(token);
  return subject === `leave-decision:${leaveId}:${decision}`;
}

async function resolveSuperAdminRecipients(): Promise<string[]> {
  const [userRows, smtpRows] = await Promise.all([
    db.select().from(schema.users),
    db.select().from(schema.userSmtpConfigs),
  ]);

  const superAdmins = userRows.filter((u) => u.active && u.role === "super_admin");
  const superAdminIds = new Set(superAdmins.map((u) => u.id));

  const configuredFromEmails = smtpRows
    .filter((c) => superAdminIds.has(c.userId) && Boolean(c.fromEmail?.trim()))
    .map((c) => c.fromEmail.trim().toLowerCase());

  const userTableEmails = superAdmins
    .map((u) => u.email.trim().toLowerCase())
    .filter((e) => e.includes("@"));

  const realEmails = Array.from(
    new Set([
      ...configuredFromEmails.filter((e) => e.includes("@")),
      ...userTableEmails.filter((e) => !e.endsWith("@sace.com")),
    ]),
  );

  if (realEmails.length > 0) {
    return realEmails;
  }
  return Array.from(new Set(userTableEmails));
}

export async function notifySuperAdminsOnPunchIn(params: {
  userId: string;
  record: AttendanceRecord;
}): Promise<void> {
  try {
    const [userRows, superAdminEmails] = await Promise.all([
      db.select().from(schema.users).where(eq(schema.users.id, params.userId)).limit(1),
      resolveSuperAdminRecipients(),
    ]);
    const emp = userRows[0];
    if (!emp) return;

    const timeLabel = formatReadableTime(params.record.punchIn);
    const officeLabel = params.record.matchedOfficeName || "Office";
    const statusText =
      params.record.lateMinutes && params.record.lateMinutes > 0
        ? `Late by ${params.record.lateMinutes} mins`
        : "On time";

    const subject = `[Workpulse] Team Login — ${emp.fullName} (${timeLabel})`;
    const text = [
      `Team Member Logged In (Attendance Punch In)`,
      ``,
      `Employee: ${emp.fullName} (${emp.designation || emp.role} · ${emp.department})`,
      `Email: ${emp.email}`,
      `Date: ${params.record.date}`,
      `Punch-In Time: ${timeLabel}`,
      `Office Location: ${officeLabel}`,
      `Geofence Status: ${params.record.geofenceStatus ?? "Verified"}`,
      `Punctuality: ${statusText}`,
    ].join("\n");

    const html = `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <div style="background:#520380;color:#fff;padding:16px 20px">
          <h2 style="margin:0;font-size:16px">Team Login Notification</h2>
          <p style="margin:4px 0 0;font-size:12px;opacity:.9">${escapeHtml(params.record.date)} · ${escapeHtml(timeLabel)}</p>
        </div>
        <div style="padding:18px 20px;font-size:14px;color:#111827;line-height:1.5">
          <p style="margin:0 0 12px"><strong>${escapeHtml(emp.fullName)}</strong> has punched in for today&apos;s shift.</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr><td style="padding:4px 0;color:#6b7280">Department</td><td style="padding:4px 0;font-weight:600">${escapeHtml(emp.department)} (${escapeHtml(emp.designation || emp.role)})</td></tr>
            <tr><td style="padding:4px 0;color:#6b7280">Punch-In Time</td><td style="padding:4px 0;font-weight:600">${escapeHtml(timeLabel)}</td></tr>
            <tr><td style="padding:4px 0;color:#6b7280">Location</td><td style="padding:4px 0;font-weight:600">${escapeHtml(officeLabel)} (${escapeHtml(params.record.geofenceStatus ?? "Verified")})</td></tr>
            <tr><td style="padding:4px 0;color:#6b7280">Status</td><td style="padding:4px 0;font-weight:600">${escapeHtml(statusText)}</td></tr>
          </table>
        </div>
      </div>
    `;

    const teamsText = [
      `**${emp.fullName}** (${emp.department}) punched in at **${timeLabel}**`,
      `• Location: ${officeLabel} (${params.record.geofenceStatus ?? "Verified"})`,
      `• Status: ${statusText}`,
    ].join("\n\n");

    await sendPortalMailAndTeamsAlert({
      preferredSenderUserId: emp.id,
      toEmails: superAdminEmails,
      replyTo: emp.email,
      subject,
      text,
      html,
      teamsTitle: subject,
      teamsText,
    });
  } catch (err) {
    console.error("[SACE Notify] Punch-in notification error:", err);
  }
}

export async function notifySuperAdminsOnPunchOutAndCheckDailyEod(params: {
  prevAttendance: AttendanceRecord[];
  nextAttendance: AttendanceRecord[];
  prevEodReports: EodReport[];
  nextEodReports: EodReport[];
  users: User[];
}): Promise<void> {
  try {
    const prevById = new Map(params.prevAttendance.map((a) => [a.id, a]));
    const usersById = new Map(params.users.map((u) => [u.id, u]));
    const superAdminEmails = await resolveSuperAdminRecipients();

    const newlyLoggedOut: AttendanceRecord[] = [];
    for (const nextRec of params.nextAttendance) {
      const prevRec = prevById.get(nextRec.id);
      const hadPunchOut = Boolean(prevRec?.punchOut);
      if (!hadPunchOut && Boolean(nextRec.punchOut) && Boolean(nextRec.punchIn)) {
        newlyLoggedOut.push(nextRec);
      }
    }

    // 1. Send individual logout alert to Super Admin(s) + Teams
    for (const rec of newlyLoggedOut) {
      const emp = usersById.get(rec.userId);
      if (!emp) continue;
      const inLabel = formatReadableTime(rec.punchIn);
      const outLabel = formatReadableTime(rec.punchOut);
      const hoursStr = `${Number(rec.hours || 0).toFixed(2)} hrs`;

      const subject = `[Workpulse] Team Logout — ${emp.fullName} (${outLabel})`;
      const text = [
        `Team Member Logged Out (Attendance Punch Out)`,
        ``,
        `Employee: ${emp.fullName} (${emp.designation || emp.role} · ${emp.department})`,
        `Date: ${rec.date}`,
        `Shift: ${inLabel} → ${outLabel}`,
        `Total Hours Worked: ${hoursStr}`,
        `Location: ${rec.matchedOfficeName || "Office"}`,
      ].join("\n");

      const html = `
        <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
          <div style="background:#0f766e;color:#fff;padding:16px 20px">
            <h2 style="margin:0;font-size:16px">Team Logout Notification</h2>
            <p style="margin:4px 0 0;font-size:12px;opacity:.9">${escapeHtml(rec.date)} · ${escapeHtml(outLabel)}</p>
          </div>
          <div style="padding:18px 20px;font-size:14px;color:#111827;line-height:1.5">
            <p style="margin:0 0 12px"><strong>${escapeHtml(emp.fullName)}</strong> has punched out for today.</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <tr><td style="padding:4px 0;color:#6b7280">Department</td><td style="padding:4px 0;font-weight:600">${escapeHtml(emp.department)}</td></tr>
              <tr><td style="padding:4px 0;color:#6b7280">Shift Time</td><td style="padding:4px 0;font-weight:600">${escapeHtml(inLabel)} → ${escapeHtml(outLabel)}</td></tr>
              <tr><td style="padding:4px 0;color:#6b7280">Hours Worked</td><td style="padding:4px 0;font-weight:600">${escapeHtml(hoursStr)}</td></tr>
            </table>
          </div>
        </div>
      `;

      await sendPortalMailAndTeamsAlert({
        preferredSenderUserId: emp.id,
        toEmails: superAdminEmails,
        replyTo: emp.email,
        subject,
        text,
        html,
        teamsTitle: subject,
        teamsText: `**${emp.fullName}** (${emp.department}) punched out at **${outLabel}** (${inLabel} → ${outLabel} · **${hoursStr}**)`,
      });
    }

    // 2. Check if today's EOD digest should fire after the LAST logout of the day
    const candidateDates = new Set<string>(newlyLoggedOut.map((r) => r.date));
    const prevEodById = new Map(params.prevEodReports.map((e) => [e.id, e]));
    for (const eod of params.nextEodReports) {
      const prev = prevEodById.get(eod.id);
      if (!prev || prev.submittedAt !== eod.submittedAt) {
        candidateDates.add(eod.date);
      }
    }

    const sigMap = getSentEodSignatureMap();
    for (const dateStr of candidateDates) {
      const dayAttendance = params.nextAttendance.filter(
        (a) => a.date === dateStr && Boolean(a.punchIn),
      );
      if (dayAttendance.length === 0) continue;

      const activeRemaining = dayAttendance.filter((a) => !a.punchOut);
      if (activeRemaining.length > 0) {
        // Still waiting for remaining team member(s) to log out
        continue;
      }

      const dayEods = params.nextEodReports.filter((e) => e.date === dateStr);
      const signature = [
        dayAttendance.length,
        dayAttendance
          .map((a) => `${a.userId}:${a.punchOut}`)
          .sort()
          .join("|"),
        dayEods
          .map((e) => `${e.userId}:${e.submittedAt}`)
          .sort()
          .join("|"),
      ].join("::");

      if (sigMap.get(dateStr) === signature) {
        continue;
      }
      sigMap.set(dateStr, signature);

      const eodByUserId = new Map(dayEods.map((e) => [e.userId, e]));
      const textSections: string[] = [
        `Daily Team EOD Summary Report (${dateStr})`,
        `All ${dayAttendance.length} punched-in team member(s) have completed their logout for the day.`,
        ``,
      ];
      const htmlRows: string[] = [];

      for (const att of dayAttendance) {
        const emp = usersById.get(att.userId);
        const name = emp?.fullName ?? att.userId;
        const dept = emp?.department ?? "Team";
        const eod = eodByUserId.get(att.userId);
        const shiftStr = `${formatReadableTime(att.punchIn)} → ${formatReadableTime(att.punchOut)} (${Number(att.hours || 0).toFixed(2)}h)`;

        textSections.push(`----------------------------------------`);
        textSections.push(`${name} (${dept}) — ${shiftStr}`);
        if (eod) {
          textSections.push(`Worked On: ${eod.worked || "—"}`);
          textSections.push(`Completed: ${eod.completed || "—"}`);
          if (eod.blockers) textSections.push(`Blockers: ${eod.blockers}`);
        } else {
          textSections.push(`EOD Report: Not submitted (punched out without written EOD)`);
        }

        htmlRows.push(`
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong style="font-size:14px;color:#111827">${escapeHtml(name)} <span style="font-weight:400;color:#6b7280">(${escapeHtml(dept)})</span></strong>
              <span style="font-size:12px;color:#0f766e;font-weight:600">${escapeHtml(shiftStr)}</span>
            </div>
            ${
              eod
                ? `<p style="margin:4px 0;font-size:13px"><strong>Worked On:</strong> ${escapeHtml(eod.worked || "—")}</p>
                   <p style="margin:4px 0;font-size:13px"><strong>Completed:</strong> ${escapeHtml(eod.completed || "—")}</p>
                   ${eod.blockers ? `<p style="margin:4px 0;font-size:13px;color:#b45309"><strong>Blockers:</strong> ${escapeHtml(eod.blockers)}</p>` : ""}`
                : `<p style="margin:4px 0;font-size:13px;color:#6b7280"><em>Punched out without a written EOD report.</em></p>`
            }
          </div>
        `);
      }

      const subject = `[Workpulse] Daily EOD Summary Report — ${dateStr} (${dayAttendance.length} logged out)`;
      const html = `
        <div style="font-family:Inter,system-ui,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
          <div style="background:#520380;color:#fff;padding:16px 20px">
            <h2 style="margin:0;font-size:16px">Daily EOD Report — After Last Logout</h2>
            <p style="margin:4px 0 0;font-size:12px;opacity:.9">${escapeHtml(dateStr)} · ${dayAttendance.length} team member(s) completed shift · ${dayEods.length} EOD report(s)</p>
          </div>
          <div style="padding:18px 20px">${htmlRows.join("")}</div>
        </div>
      `;

      const teamsSummary = dayAttendance
        .map((att) => {
          const emp = usersById.get(att.userId);
          const eod = eodByUserId.get(att.userId);
          return `• **${emp?.fullName ?? att.userId}** (${Number(att.hours || 0).toFixed(2)}h): ${eod?.completed || eod?.worked || "Punched out (no EOD text)"}`;
        })
        .join("\n\n");

      await sendPortalMailAndTeamsAlert({
        toEmails: superAdminEmails,
        subject,
        text: textSections.join("\n"),
        html,
        teamsTitle: subject,
        teamsText: teamsSummary,
      });
    }
  } catch (err) {
    console.error("[SACE Notify] Punch-out / Daily EOD notification error:", err);
  }
}

export async function notifyOnLeaveChanges(params: {
  prevLeaves: LeaveRequest[];
  nextLeaves: LeaveRequest[];
  users: User[];
  baseUrl?: string;
}): Promise<void> {
  try {
    const prevById = new Map(params.prevLeaves.map((l) => [l.id, l]));
    const usersById = new Map(params.users.map((u) => [u.id, u]));
    const superAdminEmails = await resolveSuperAdminRecipients();

    for (const leave of params.nextLeaves) {
      const prev = prevById.get(leave.id);
      const emp = usersById.get(leave.userId);
      if (!emp) continue;

      const leaveTypeLabel = leave.type === "casual" ? "Casual Leave" : "Sick Leave";
      const days = countLeaveDays(leave);

      // Case A: Newly submitted leave request -> send to Super Admin(s) with Approve / Reject links
      if (!prev) {
        const approveToken = createLeaveEmailActionToken(leave.id, "approved");
        const rejectToken = createLeaveEmailActionToken(leave.id, "rejected");
        const cleanBase = (params.baseUrl ?? "").replace(/\/$/, "");
        const approveUrl = cleanBase
          ? `${cleanBase}/api/leave/email-decision?leaveId=${encodeURIComponent(leave.id)}&decision=approved&token=${encodeURIComponent(approveToken)}`
          : "";
        const rejectUrl = cleanBase
          ? `${cleanBase}/api/leave/email-decision?leaveId=${encodeURIComponent(leave.id)}&decision=rejected&token=${encodeURIComponent(rejectToken)}`
          : "";

        const subject = `[Workpulse] Leave Application — ${emp.fullName} (${leaveTypeLabel} · ${leave.startDate})`;
        const text = [
          `New Leave Application Submitted`,
          ``,
          `Employee: ${emp.fullName} (${emp.designation || emp.role} · ${emp.department})`,
          `Email: ${emp.email}`,
          `Leave Type: ${leaveTypeLabel}`,
          `Dates: ${leave.startDate} to ${leave.endDate} (${days} day${days === 1 ? "" : "s"}${leave.halfDay ? " · Half Day" : ""})`,
          `Reason: ${leave.reason}`,
          ...(leave.emergencyContact ? [`Emergency Contact: ${leave.emergencyContact}`] : []),
          `Remaining Balances: Casual ${emp.casualBalance} · Sick ${emp.sickBalance}`,
          ...(approveUrl ? [``, `Approve: ${approveUrl}`, `Reject: ${rejectUrl}`] : []),
        ].join("\n");

        const html = `
          <div style="font-family:Inter,system-ui,sans-serif;max-width:580px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
            <div style="background:#520380;color:#fff;padding:16px 20px">
              <h2 style="margin:0;font-size:16px">Leave Application Received</h2>
              <p style="margin:4px 0 0;font-size:12px;opacity:.9">${escapeHtml(emp.fullName)} · ${escapeHtml(leaveTypeLabel)}</p>
            </div>
            <div style="padding:18px 20px;font-size:14px;color:#111827;line-height:1.5">
              <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
                <tr><td style="padding:4px 0;color:#6b7280">Employee</td><td style="padding:4px 0;font-weight:600">${escapeHtml(emp.fullName)} (${escapeHtml(emp.department)})</td></tr>
                <tr><td style="padding:4px 0;color:#6b7280">Leave Type</td><td style="padding:4px 0;font-weight:600">${escapeHtml(leaveTypeLabel)}</td></tr>
                <tr><td style="padding:4px 0;color:#6b7280">Dates</td><td style="padding:4px 0;font-weight:600">${escapeHtml(leave.startDate)} → ${escapeHtml(leave.endDate)} (${days} day${days === 1 ? "" : "s"})</td></tr>
                <tr><td style="padding:4px 0;color:#6b7280">Reason</td><td style="padding:4px 0">${escapeHtml(leave.reason)}</td></tr>
                ${leave.emergencyContact ? `<tr><td style="padding:4px 0;color:#6b7280">Emergency Contact</td><td style="padding:4px 0">${escapeHtml(leave.emergencyContact)}</td></tr>` : ""}
                <tr><td style="padding:4px 0;color:#6b7280">Current Balance</td><td style="padding:4px 0">Casual: ${emp.casualBalance} · Sick: ${emp.sickBalance}</td></tr>
              </table>
              ${
                approveUrl && rejectUrl
                  ? `<div style="display:flex;gap:10px;flex-wrap:wrap">
                      <a href="${escapeHtml(approveUrl)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:13px">Approve Leave</a>
                      <a href="${escapeHtml(rejectUrl)}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:13px">Reject Leave</a>
                    </div>`
                  : ""
              }
            </div>
          </div>
        `;

        await sendPortalMailAndTeamsAlert({
          preferredSenderUserId: emp.id,
          toEmails: superAdminEmails,
          replyTo: emp.email,
          subject,
          text,
          html,
          teamsTitle: subject,
          teamsText: `**${emp.fullName}** (${emp.department}) requested **${leaveTypeLabel}** from **${leave.startDate}** to **${leave.endDate}** (${days} day${days === 1 ? "" : "s"}).\n\nReason: ${leave.reason}`,
        });
        continue;
      }

      // Case B: Leave status transitioned from pending -> approved/rejected -> notify employee
      if (
        prev.status === "pending" &&
        (leave.status === "approved" || leave.status === "rejected")
      ) {
        await sendLeaveDecisionEmailToEmployee({ leave, employee: emp });
      }
    }
  } catch (err) {
    console.error("[SACE Notify] Leave notification error:", err);
  }
}

export async function sendLeaveDecisionEmailToEmployee(params: {
  leave: LeaveRequest;
  employee: User;
}): Promise<void> {
  const { leave, employee } = params;
  const leaveTypeLabel = leave.type === "casual" ? "Casual Leave" : "Sick Leave";
  const decisionLabel = leave.status === "approved" ? "Approved" : "Rejected";
  const days = countLeaveDays(leave);

  const subject = `[Workpulse] Leave Request ${decisionLabel} — ${leave.startDate}`;
  const text = [
    `Hello ${employee.fullName},`,
    ``,
    `Your ${leaveTypeLabel} request has been ${decisionLabel.toLowerCase()}.`,
    ``,
    `Dates: ${leave.startDate} to ${leave.endDate} (${days} day${days === 1 ? "" : "s"})`,
    `Status: ${decisionLabel}`,
    ...(leave.adminComment ? [`Admin Comment: ${leave.adminComment}`] : []),
  ].join("\n");

  const headerColor = leave.status === "approved" ? "#16a34a" : "#dc2626";
  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <div style="background:${headerColor};color:#fff;padding:16px 20px">
        <h2 style="margin:0;font-size:16px">Leave Request ${escapeHtml(decisionLabel)}</h2>
        <p style="margin:4px 0 0;font-size:12px;opacity:.9">${escapeHtml(leaveTypeLabel)} · ${escapeHtml(leave.startDate)} → ${escapeHtml(leave.endDate)}</p>
      </div>
      <div style="padding:18px 20px;font-size:14px;color:#111827;line-height:1.5">
        <p style="margin:0 0 12px">Hello <strong>${escapeHtml(employee.fullName)}</strong>, your leave application has been <strong>${escapeHtml(decisionLabel.toLowerCase())}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr><td style="padding:4px 0;color:#6b7280">Leave Type</td><td style="padding:4px 0;font-weight:600">${escapeHtml(leaveTypeLabel)}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280">Dates</td><td style="padding:4px 0;font-weight:600">${escapeHtml(leave.startDate)} → ${escapeHtml(leave.endDate)} (${days} day${days === 1 ? "" : "s"})</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280">Admin Comment</td><td style="padding:4px 0">${escapeHtml(leave.adminComment || `${decisionLabel}.`)}</td></tr>
        </table>
      </div>
    </div>
  `;

  await sendPortalMailAndTeamsAlert({
    toEmails: [employee.email],
    subject,
    text,
    html,
    notifySuperAdminTeams: false,
  });
}

function renderLeaveDecisionPage(opts: {
  title: string;
  subtitle: string;
  bodyHtml: string;
  accent?: string;
}): Response {
  const accent = opts.accent ?? "#520380";
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)} — SACE Workpulse</title>
    <style>
      body { font-family: Inter, system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 20px; }
      .card { max-width: 500px; width: 100%; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(15,23,42,.06); }
      .hdr { background: ${accent}; color: #fff; padding: 18px 22px; }
      .hdr h1 { margin: 0; font-size: 18px; }
      .hdr p { margin: 4px 0 0; font-size: 13px; opacity: .9; }
      .cnt { padding: 22px; font-size: 14px; line-height: 1.55; }
      .btn { display: inline-block; padding: 10px 18px; border-radius: 8px; border: 0; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
      .btn-primary { background: ${accent}; color: #fff; }
      .btn-secondary { background: #f1f5f9; color: #0f172a; margin-left: 8px; }
      textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; margin: 8px 0 14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="hdr">
        <h1>${escapeHtml(opts.title)}</h1>
        <p>${escapeHtml(opts.subtitle)}</p>
      </div>
      <div class="cnt">${opts.bodyHtml}</div>
    </div>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function handleLeaveEmailDecisionRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let leaveId = (url.searchParams.get("leaveId") ?? "").trim();
  let decisionRaw = (url.searchParams.get("decision") ?? "").trim();
  let token = (url.searchParams.get("token") ?? "").trim();
  let adminComment = "";

  if (request.method === "POST") {
    const formData = await request.formData();
    leaveId = String(formData.get("leaveId") ?? leaveId).trim();
    decisionRaw = String(formData.get("decision") ?? decisionRaw).trim();
    token = String(formData.get("token") ?? token).trim();
    adminComment = String(formData.get("comment") ?? "")
      .trim()
      .slice(0, 400);
  } else if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (
    !leaveId ||
    (decisionRaw !== "approved" && decisionRaw !== "rejected") ||
    !token ||
    !verifyLeaveEmailActionToken(token, leaveId, decisionRaw)
  ) {
    return renderLeaveDecisionPage({
      title: "Invalid or Expired Link",
      subtitle: "SACE Workpulse Leave Review",
      accent: "#dc2626",
      bodyHtml: `<p>This leave approval link is invalid or has expired. Please review the request directly from the portal.</p><p><a href="/leave" class="btn btn-primary">Open Leave Requests</a></p>`,
    });
  }

  const [stateRows, userRows] = await Promise.all([
    db.select().from(schema.portalState).where(eq(schema.portalState.id, PORTAL_STATE_ID)).limit(1),
    db.select().from(schema.users),
  ]);
  const currentState = (stateRows[0]?.data as AppState | undefined) ?? createEmptyPortalState();
  const leaveIndex = (currentState.leaves ?? []).findIndex((l) => l.id === leaveId);
  if (leaveIndex < 0) {
    return renderLeaveDecisionPage({
      title: "Leave Request Not Found",
      subtitle: "SACE Workpulse Leave Review",
      accent: "#dc2626",
      bodyHtml: `<p>This leave request could not be found.</p><p><a href="/leave" class="btn btn-primary">Open Leave Requests</a></p>`,
    });
  }

  const leave = currentState.leaves[leaveIndex]!;
  const employeeRow = userRows.find((u) => u.id === leave.userId);
  const employeeName = employeeRow?.fullName ?? leave.userId;
  const leaveTypeLabel = leave.type === "casual" ? "Casual Leave" : "Sick Leave";
  const days = countLeaveDays(leave);

  if (leave.status !== "pending") {
    return renderLeaveDecisionPage({
      title: `Already ${leave.status === "approved" ? "Approved" : "Rejected"}`,
      subtitle: `${employeeName} · ${leaveTypeLabel}`,
      accent: leave.status === "approved" ? "#16a34a" : "#dc2626",
      bodyHtml: `<p>This leave request (${escapeHtml(leave.startDate)} → ${escapeHtml(leave.endDate)}) has already been marked as <strong>${escapeHtml(leave.status)}</strong>.</p><p><a href="/leave" class="btn btn-primary">Open Leave Requests</a></p>`,
    });
  }

  if (request.method === "GET") {
    const isApprove = decisionRaw === "approved";
    return renderLeaveDecisionPage({
      title: isApprove ? "Confirm Leave Approval" : "Confirm Leave Rejection",
      subtitle: `${employeeName} · ${leaveTypeLabel}`,
      accent: isApprove ? "#16a34a" : "#dc2626",
      bodyHtml: `
        <p><strong>Employee:</strong> ${escapeHtml(employeeName)}</p>
        <p><strong>Dates:</strong> ${escapeHtml(leave.startDate)} → ${escapeHtml(leave.endDate)} (${days} day${days === 1 ? "" : "s"})</p>
        <p><strong>Reason:</strong> ${escapeHtml(leave.reason)}</p>
        <form method="POST" action="/api/leave/email-decision">
          <input type="hidden" name="leaveId" value="${escapeHtml(leaveId)}" />
          <input type="hidden" name="decision" value="${escapeHtml(decisionRaw)}" />
          <input type="hidden" name="token" value="${escapeHtml(token)}" />
          <label for="comment" style="font-size:13px;font-weight:600;display:block;margin-top:12px">Optional comment for employee</label>
          <textarea id="comment" name="comment" rows="3" placeholder="${isApprove ? "Approved." : "Rejected."}"></textarea>
          <button type="submit" class="btn btn-primary">${isApprove ? "Confirm Approve Leave" : "Confirm Reject Leave"}</button>
          <a href="/leave" class="btn btn-secondary">Cancel</a>
        </form>
      `,
    });
  }

  // POST: Apply approval/rejection, deduct leave balance, persist, and email employee
  const finalComment = adminComment || (decisionRaw === "approved" ? "Approved." : "Rejected.");
  const updatedLeave: LeaveRequest = {
    ...leave,
    status: decisionRaw,
    adminComment: finalComment,
  };
  const updatedLeaves = [...currentState.leaves];
  updatedLeaves[leaveIndex] = updatedLeave;

  if (decisionRaw === "approved" && employeeRow) {
    const nextPatch =
      leave.type === "casual"
        ? { casualBalance: Math.max(0, Math.round(employeeRow.casualBalance - days)) }
        : { sickBalance: Math.max(0, Math.round(employeeRow.sickBalance - days)) };
    await db.update(schema.users).set(nextPatch).where(eq(schema.users.id, employeeRow.id));
  }

  const refreshedUserRows = await db.select().from(schema.users);
  const publicUsers = stripCredentialsFromUsers(refreshedUserRows.map(toPublicUser));

  const nowIso = new Date().toISOString();
  const notif: AppNotification = {
    id: crypto.randomUUID().slice(0, 12),
    userId: leave.userId,
    title: `Leave ${decisionRaw}`,
    body: `${leaveTypeLabel} ${leave.startDate} (${finalComment})`,
    href: "/leave",
    read: false,
    at: nowIso,
  };
  const auditEntry: AuditLog = {
    id: crypto.randomUUID().slice(0, 12),
    actorId: refreshedUserRows.find((u) => u.role === "super_admin")?.id ?? leave.userId,
    action: `Leave ${decisionRaw} (via email)`,
    detail: `${leaveTypeLabel} for ${employeeName} (${leave.startDate} → ${leave.endDate})`,
    at: nowIso,
  };

  const nextState: AppState = {
    ...currentState,
    users: publicUsers,
    leaves: updatedLeaves,
    notifications: [notif, ...(currentState.notifications ?? [])].slice(0, 5000),
    audit: [auditEntry, ...(currentState.audit ?? [])].slice(0, 5000),
    sessionUserId: null,
  };

  await db
    .insert(schema.portalState)
    .values({ id: PORTAL_STATE_ID, data: nextState })
    .onConflictDoUpdate({
      target: schema.portalState.id,
      set: { data: nextState, updatedAt: new Date() },
    });

  if (employeeRow) {
    await sendLeaveDecisionEmailToEmployee({
      leave: updatedLeave,
      employee: toPublicUser(employeeRow),
    });
  }

  return renderLeaveDecisionPage({
    title: decisionRaw === "approved" ? "Leave Approved" : "Leave Rejected",
    subtitle: `${employeeName} · ${leaveTypeLabel}`,
    accent: decisionRaw === "approved" ? "#16a34a" : "#dc2626",
    bodyHtml: `
      <p>The leave request for <strong>${escapeHtml(employeeName)}</strong> (${escapeHtml(leave.startDate)} → ${escapeHtml(leave.endDate)}) has been marked as <strong>${escapeHtml(decisionRaw)}</strong>, and an email notification has been sent to the employee.</p>
      <p><a href="/leave" class="btn btn-primary">View All Leave Requests</a></p>
    `,
  });
}
