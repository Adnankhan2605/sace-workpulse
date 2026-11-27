import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { stripCredentialsFromUsers, toPublicUser } from "./auth.server.ts";
import {
  CreateBattalionSchema,
  DeleteBattalionSchema,
  UpdatePresenceSchema,
  calculateAvailabilityWindow,
  type CreateBattalionInput,
  type UpdatePresenceInput,
} from "./battalion.ts";
import { assertModuleAccess } from "./permissions.server.ts";
import { assertRateLimit } from "./rate-limit.server.ts";
import { createEmptyPortalState } from "./seed.ts";
import type {
  AppState,
  AuditLog,
  Battalion,
  BattalionMember,
  PopulatedBattalion,
  Role,
  UserPresence,
} from "./types.ts";

const PORTAL_STATE_ID = "current_state";

export {
  CreateBattalionSchema,
  DeleteBattalionSchema,
  UpdatePresenceSchema,
  type CreateBattalionInput,
  type UpdatePresenceInput,
};

async function loadPortalStateAndUsers() {
  const [stateRows, userRows] = await Promise.all([
    db.select().from(schema.portalState).where(eq(schema.portalState.id, PORTAL_STATE_ID)).limit(1),
    db.select().from(schema.users),
  ]);
  const existing = (stateRows[0]?.data as AppState | undefined) ?? createEmptyPortalState();
  const publicUsers = userRows.map(toPublicUser);
  return { existing, publicUsers };
}

async function persistPortalState(nextState: AppState) {
  await db
    .insert(schema.portalState)
    .values({ id: PORTAL_STATE_ID, data: nextState })
    .onConflictDoUpdate({
      target: schema.portalState.id,
      set: { data: nextState, updatedAt: new Date() },
    });
}

export async function saveUserPresenceRecord(
  callerId: string,
  rawInput: unknown,
  callerRole: Role = "member",
): Promise<{ ok: true; presence: UserPresence }> {
  await assertModuleAccess(callerId, callerRole, "battalion", "edit");
  assertRateLimit(`presence:${callerId}`, { limit: 60, windowMs: 60_000 });
  const parsed = UpdatePresenceSchema.parse(rawInput);

  const { availableFrom, availableUntil } = calculateAvailabilityWindow({
    durationMinutes: parsed.durationMinutes,
    customStartTime: parsed.customStartTime ?? null,
    customEndTime: parsed.customEndTime ?? null,
  });

  const { existing, publicUsers } = await loadPortalStateAndUsers();
  const nowIso = new Date().toISOString();

  const presence: UserPresence = {
    userId: callerId,
    status: parsed.status,
    isCustomStatus: parsed.isCustomStatus,
    availableFor: parsed.availableFor,
    isCustomAvailability: parsed.isCustomAvailability,
    availableFrom,
    availableUntil,
    updatedAt: nowIso,
  };

  const nextState: AppState = {
    ...existing,
    users: stripCredentialsFromUsers(publicUsers),
    userPresence: {
      ...(existing.userPresence ?? {}),
      [callerId]: presence,
    },
    sessionUserId: null,
  };

  await persistPortalState(nextState);
  return { ok: true, presence };
}

export async function fetchPopulatedBattalions(
  callerId: string,
  callerRole: Role = "member",
): Promise<{
  ok: true;
  battalions: PopulatedBattalion[];
  members: BattalionMember[];
  myPresence: UserPresence | null;
}> {
  await assertModuleAccess(callerId, callerRole, "battalion", "view");
  assertRateLimit(`battalions-read:${callerId}`, { limit: 120, windowMs: 60_000 });
  const { existing, publicUsers } = await loadPortalStateAndUsers();
  const presenceMap = existing.userPresence ?? {};
  const activeUsers = publicUsers.filter((u) => u.active);

  const memberLookup = new Map<string, BattalionMember>();
  const allMembers: BattalionMember[] = activeUsers.map((u) => {
    const member: BattalionMember = {
      id: u.id,
      fullName: u.fullName,
      username: u.username,
      designation: u.designation,
      department: u.department,
      role: u.role,
      avatarColor: u.avatarColor,
      avatarUrl: u.avatarUrl ?? null,
      presence: presenceMap[u.id] ?? null,
    };
    memberLookup.set(u.id, member);
    return member;
  });

  const rawBattalions = existing.battalions ?? [];
  const populated: PopulatedBattalion[] = rawBattalions.map((b) => ({
    ...b,
    members: b.memberIds
      .map((id) => memberLookup.get(id))
      .filter((m): m is BattalionMember => Boolean(m)),
  }));

  return {
    ok: true,
    battalions: populated,
    members: allMembers,
    myPresence: presenceMap[callerId] ?? null,
  };
}

export async function createBattalionRecord(
  callerId: string,
  callerRole: Role,
  rawInput: unknown,
): Promise<{ ok: true; battalion: PopulatedBattalion }> {
  await assertModuleAccess(callerId, callerRole, "battalion", "edit");

  assertRateLimit(`battalions-write:${callerId}`, { limit: 30, windowMs: 60_000 });
  const parsed = CreateBattalionSchema.parse(rawInput);

  const { existing, publicUsers } = await loadPortalStateAndUsers();
  const activeIdSet = new Set(publicUsers.filter((u) => u.active).map((u) => u.id));
  const validMemberIds = Array.from(new Set(parsed.memberIds.filter((id) => activeIdSet.has(id))));

  if (validMemberIds.length === 0) {
    throw new Error("Select at least one active team member for the Battalion.");
  }

  const nowIso = new Date().toISOString();
  const newBattalion: Battalion = {
    id: `bat-${crypto.randomUUID().slice(0, 10)}`,
    name: parsed.name,
    description: parsed.description,
    createdBy: callerId,
    memberIds: validMemberIds,
    createdAt: nowIso,
  };

  const auditEntry: AuditLog = {
    id: `aud-${crypto.randomUUID().slice(0, 10)}`,
    actorId: callerId,
    action: "battalion_created",
    detail: `Created Battalion "${newBattalion.name}" with ${validMemberIds.length} member(s).`,
    at: nowIso,
  };

  const nextState: AppState = {
    ...existing,
    users: stripCredentialsFromUsers(publicUsers),
    battalions: [newBattalion, ...(existing.battalions ?? [])],
    audit: [auditEntry, ...(existing.audit ?? [])].slice(0, 5000),
    sessionUserId: null,
  };

  await persistPortalState(nextState);

  const presenceMap = nextState.userPresence ?? {};
  const populatedMembers: BattalionMember[] = publicUsers
    .filter((u) => validMemberIds.includes(u.id))
    .map((u) => ({
      id: u.id,
      fullName: u.fullName,
      username: u.username,
      designation: u.designation,
      department: u.department,
      role: u.role,
      avatarColor: u.avatarColor,
      avatarUrl: u.avatarUrl ?? null,
      presence: presenceMap[u.id] ?? null,
    }));

  return {
    ok: true,
    battalion: {
      ...newBattalion,
      members: populatedMembers,
    },
  };
}

export async function deleteBattalionRecord(
  callerId: string,
  callerRole: Role,
  rawInput: unknown,
): Promise<{ ok: true }> {
  await assertModuleAccess(callerId, callerRole, "battalion", "edit");

  assertRateLimit(`battalions-write:${callerId}`, { limit: 30, windowMs: 60_000 });
  const parsed = DeleteBattalionSchema.parse(rawInput);

  const { existing, publicUsers } = await loadPortalStateAndUsers();
  const target = (existing.battalions ?? []).find((b) => b.id === parsed.battalionId);
  if (!target) {
    throw new Error("Battalion squad not found.");
  }

  const nowIso = new Date().toISOString();
  const auditEntry: AuditLog = {
    id: `aud-${crypto.randomUUID().slice(0, 10)}`,
    actorId: callerId,
    action: "battalion_deleted",
    detail: `Removed Battalion "${target.name}".`,
    at: nowIso,
  };

  const nextState: AppState = {
    ...existing,
    users: stripCredentialsFromUsers(publicUsers),
    battalions: (existing.battalions ?? []).filter((b) => b.id !== parsed.battalionId),
    audit: [auditEntry, ...(existing.audit ?? [])].slice(0, 5000),
    sessionUserId: null,
  };

  await persistPortalState(nextState);
  return { ok: true };
}
