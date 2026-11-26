import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { assertPersistentStorageReady, db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import {
  ensurePortalInitialized,
  getAdminPermsFromState,
  hashPassword,
  stripCredentialsFromUsers,
  toPublicUser,
} from "./auth.server.ts";
import { assertRateLimit } from "./rate-limit.server.ts";
import {
  CreateAccountSchema,
  DeleteAccountSchema,
  SaveAccountSchema,
  SaveAdminPermsSchema,
  normalizeAccountPayloadKeys,
  type CreateAccountInput,
  type SaveAccountInput,
} from "./accounts.schemas.ts";
import type { AppState, Role, User } from "./types.ts";

const PORTAL_STATE_ID = "current_state";

interface CallerContext {
  userId: string;
  role: Role;
}

async function syncUsersToPortalState(): Promise<void> {
  const [allUsers, stateRows] = await Promise.all([
    db.select().from(schema.users),
    db.select().from(schema.portalState).where(eq(schema.portalState.id, PORTAL_STATE_ID)).limit(1),
  ]);
  const current = stateRows[0]?.data as AppState | undefined;
  if (!current) return;
  const publicUsers = stripCredentialsFromUsers(allUsers.map(toPublicUser));
  await db
    .update(schema.portalState)
    .set({
      data: {
        ...current,
        users: publicUsers,
      },
      updatedAt: new Date(),
    })
    .where(eq(schema.portalState.id, PORTAL_STATE_ID));
}

export async function listUsersRecord(caller: CallerContext): Promise<User[]> {
  await ensurePortalInitialized();
  const rows = await db.select().from(schema.users);
  const publicUsers = rows.map(toPublicUser);
  if (caller.role === "super_admin") {
    return publicUsers;
  }
  if (caller.role === "admin") {
    const perms = await getAdminPermsFromState();
    if (perms.includes("manage_users")) {
      return publicUsers.filter(
        (u) => u.reportingAdminId === caller.userId || u.id === caller.userId,
      );
    }
    return publicUsers.filter(
      (u) => u.reportingAdminId === caller.userId || u.id === caller.userId,
    );
  }
  return publicUsers.filter((u) => u.id === caller.userId);
}

export async function createAccountRecord(
  caller: CallerContext,
  rawInput: CreateAccountInput | unknown,
): Promise<{ ok: true; user: User }> {
  const data = CreateAccountSchema.parse(normalizeAccountPayloadKeys(rawInput));

  const isSuperAdmin = caller.role === "super_admin";
  if (!isSuperAdmin) {
    if (caller.role !== "admin") {
      throw new Error("Forbidden: Only a Super Admin or authorized Admin can create accounts.");
    }
    const adminPerms = await getAdminPermsFromState();
    if (!adminPerms.includes("manage_users")) {
      throw new Error("Forbidden: You do not have permission to create team accounts.");
    }
    if (data.role !== "member") {
      throw new Error("Forbidden: Only a Super Admin can create Admin or Super Admin accounts.");
    }
  }

  assertRateLimit(`accounts:${caller.userId}`, { limit: 30, windowMs: 60_000 });
  await assertPersistentStorageReady();
  await ensurePortalInitialized();

  const email = data.email.trim().toLowerCase();
  const existingEmail = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .limit(1);
  if (existingEmail.length > 0) {
    throw new Error("An account with this email already exists.");
  }

  const base = (email.split("@")[0] ?? "user").replace(/[^a-z0-9._-]/g, "") || "user";
  let username = base;
  for (let i = 1; i < 50; i += 1) {
    const taken = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.username}) = ${username}`)
      .limit(1);
    if (taken.length === 0) break;
    username = `${base}${i}`;
  }

  let id = `u-${crypto.randomUUID().slice(0, 12)}`;
  const reportingAdminId =
    data.role === "member"
      ? data.reportingAdminId?.trim() || (caller.role === "admin" ? caller.userId : null)
      : null;

  const { hasSupabaseAdminConfig } = await import("@/integrations/supabase/client.server");
  if (hasSupabaseAdminConfig()) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(created.error?.message ?? "Could not create the sign-in account.");
    }
    id = created.data.user.id;

    await supabaseAdmin.from("profiles").insert({
      id,
      email,
      username,
      full_name: data.fullName.trim(),
      designation: data.designation.trim() || "Team Member",
      department: data.department.trim() || "General",
      reporting_admin_id: reportingAdminId,
      avatar_color: data.avatarColor,
      active: true,
    } as never);
    await supabaseAdmin.from("user_roles").insert({ user_id: id, role: data.role });
  }

  const skipSchedule = Boolean(data.skipSchedule);
  const casualBalance = skipSchedule ? 12 : (data.casualBalance ?? 12);
  const sickBalance = skipSchedule ? 12 : (data.sickBalance ?? 12);
  const shiftStartTime = skipSchedule ? null : (data.shiftStartTime ?? null);
  const shiftEndTime = skipSchedule ? null : (data.shiftEndTime ?? null);
  const weekOffs = skipSchedule
    ? null
    : Array.isArray(data.weekOffs)
      ? Array.from(new Set(data.weekOffs))
      : null;
  const workMode = skipSchedule ? "WFO" : (data.workMode ?? "WFO");
  const geoFenceMandatory = skipSchedule ? true : (data.geoFenceMandatory ?? true);

  await db.insert(schema.users).values({
    id,
    fullName: data.fullName.trim(),
    username,
    email,
    password: hashPassword(data.password),
    designation: (data.designation ?? "").trim() || "Team Member",
    department: (data.department ?? "").trim() || "General",
    role: data.role,
    reportingAdminId,
    active: true,
    dailyVision: null,
    avatarColor:
      data.avatarColor || (data.role === "member" ? "var(--brand-gold)" : "var(--brand-purple)"),
    avatarUrl: null,
    casualBalance,
    sickBalance,
    shiftStartTime,
    shiftEndTime,
    weekOffs,
    workMode,
    geoFenceMandatory,
  });

  const persistedRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);

  const persisted = persistedRows[0];
  if (!persisted) {
    throw new Error("Account insertion could not be verified in the database.");
  }

  await syncUsersToPortalState();

  return {
    ok: true as const,
    user: toPublicUser(persisted),
  };
}

export async function saveAccountRecord(
  caller: CallerContext,
  rawInput: SaveAccountInput | unknown,
): Promise<{ ok: true; user?: User }> {
  const data = SaveAccountSchema.parse(normalizeAccountPayloadKeys(rawInput));

  assertRateLimit(`accounts:${caller.userId}`, { limit: 60, windowMs: 60_000 });
  await assertPersistentStorageReady();
  await ensurePortalInitialized();

  const isSuperAdmin = caller.role === "super_admin";
  const isAdmin = caller.role === "admin";
  const isSelf = data.userId === caller.userId;

  if (!isSuperAdmin && !isSelf && !isAdmin) {
    throw new Error("Forbidden: You can only edit your own profile.");
  }

  const targetRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, data.userId))
    .limit(1);
  const targetUser = targetRows[0];
  if (!targetUser) {
    throw new Error("Account not found.");
  }

  const hasPolicyChange =
    data.shiftStartTime !== undefined ||
    data.shiftEndTime !== undefined ||
    data.weekOffs !== undefined ||
    data.workMode !== undefined ||
    data.geoFenceMandatory !== undefined;

  if (!isSuperAdmin) {
    if (data.role !== undefined || data.reportingAdminId !== undefined) {
      throw new Error("Forbidden: Only a Super Admin can change roles or reporting lines.");
    }

    if (!isSelf) {
      const adminPerms = isAdmin ? await getAdminPermsFromState() : [];
      const canManageUsers = isAdmin && adminPerms.includes("manage_users");
      const canApproveLeave = isAdmin && adminPerms.includes("approve_leave");

      const onlyBalanceOrPolicyChange =
        data.fullName === undefined &&
        data.email === undefined &&
        data.designation === undefined &&
        data.department === undefined &&
        data.dailyVision === undefined &&
        data.avatarUrl === undefined &&
        data.active === undefined &&
        data.password === undefined;

      const isAuthorizedMemberEdit =
        canManageUsers &&
        targetUser.role === "member" &&
        targetUser.reportingAdminId === caller.userId &&
        data.password === undefined &&
        data.dailyVision === undefined &&
        data.avatarUrl === undefined;

      if (
        !(
          isAdmin &&
          onlyBalanceOrPolicyChange &&
          (canApproveLeave || canManageUsers || targetUser.reportingAdminId === caller.userId)
        ) &&
        !isAuthorizedMemberEdit
      ) {
        if (data.active !== undefined && !isAuthorizedMemberEdit) {
          throw new Error(
            "Forbidden: Only a Super Admin or an authorized Admin for their direct member reports can change active status.",
          );
        }
        throw new Error("Forbidden: Insufficient permissions to modify another user's account.");
      }
    } else {
      if (data.active !== undefined) {
        throw new Error("Forbidden: Only a Super Admin can change account active status.");
      }
      if (data.casualBalance !== undefined || data.sickBalance !== undefined || hasPolicyChange) {
        throw new Error(
          "Forbidden: You cannot modify your own leave balances or attendance policy.",
        );
      }
    }
  }

  const dbPatch: Partial<typeof schema.users.$inferInsert> = {};
  if (data.fullName !== undefined) dbPatch.fullName = data.fullName.trim();
  if (data.email !== undefined) dbPatch.email = data.email.trim().toLowerCase();
  if (data.designation !== undefined) dbPatch.designation = data.designation.trim();
  if (data.department !== undefined) dbPatch.department = data.department.trim();
  if (data.dailyVision !== undefined) dbPatch.dailyVision = data.dailyVision;
  if (data.avatarUrl !== undefined) dbPatch.avatarUrl = data.avatarUrl;
  if (data.reportingAdminId !== undefined) dbPatch.reportingAdminId = data.reportingAdminId;
  if (data.casualBalance !== undefined) dbPatch.casualBalance = data.casualBalance;
  if (data.sickBalance !== undefined) dbPatch.sickBalance = data.sickBalance;
  if (data.shiftStartTime !== undefined) dbPatch.shiftStartTime = data.shiftStartTime;
  if (data.shiftEndTime !== undefined) dbPatch.shiftEndTime = data.shiftEndTime;
  if (data.weekOffs !== undefined) {
    dbPatch.weekOffs = Array.isArray(data.weekOffs) ? Array.from(new Set(data.weekOffs)) : null;
  }
  if (data.workMode !== undefined) dbPatch.workMode = data.workMode;
  if (data.geoFenceMandatory !== undefined) dbPatch.geoFenceMandatory = data.geoFenceMandatory;
  if (data.active !== undefined) dbPatch.active = data.active;
  if (data.role !== undefined) dbPatch.role = data.role;
  if (data.password !== undefined) dbPatch.password = hashPassword(data.password);

  if (Object.keys(dbPatch).length > 0) {
    await db.update(schema.users).set(dbPatch).where(eq(schema.users.id, data.userId));
    await syncUsersToPortalState();
  }

  const { hasSupabaseAdminConfig } = await import("@/integrations/supabase/client.server");
  if (hasSupabaseAdminConfig()) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.fullName !== undefined) patch["full_name"] = data.fullName.trim();
    if (data.email !== undefined) patch["email"] = data.email.trim().toLowerCase();
    if (data.designation !== undefined) patch["designation"] = data.designation.trim();
    if (data.department !== undefined) patch["department"] = data.department.trim();
    if (data.dailyVision !== undefined) patch["daily_vision"] = data.dailyVision;
    if (data.avatarUrl !== undefined) patch["avatar_url"] = data.avatarUrl;
    if (data.reportingAdminId !== undefined) patch["reporting_admin_id"] = data.reportingAdminId;
    if (data.casualBalance !== undefined) patch["casual_balance"] = data.casualBalance;
    if (data.sickBalance !== undefined) patch["sick_balance"] = data.sickBalance;
    if (data.active !== undefined) patch["active"] = data.active;

    if (Object.keys(patch).length > 0) {
      patch["updated_at"] = new Date().toISOString();
      await supabaseAdmin
        .from("profiles")
        .update(patch as never)
        .eq("id", data.userId);
    }
    if (data.role) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
      await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: data.role });
    }
    if (data.password) {
      await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        password: data.password,
        ...(data.email !== undefined ? { email: data.email.trim().toLowerCase() } : {}),
      });
    }
  }

  const refreshed = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, data.userId))
    .limit(1);

  return {
    ok: true as const,
    ...(refreshed[0] ? { user: toPublicUser(refreshed[0]) } : {}),
  };
}

export async function deleteAccountRecord(
  caller: CallerContext,
  rawInput: { userId: string } | unknown,
): Promise<{ ok: true; deletedUserId: string }> {
  const data = DeleteAccountSchema.parse(rawInput);

  if (caller.role !== "super_admin" && caller.role !== "admin") {
    throw new Error("Forbidden: Only a Super Admin or Admin can delete an account.");
  }
  if (
    data.userId === caller.userId ||
    data.userId === "u-hakeem" ||
    data.userId === "u-superadmin"
  ) {
    throw new Error("Forbidden: You cannot delete your own or the primary Super Admin account.");
  }

  await assertPersistentStorageReady();
  await ensurePortalInitialized();

  const targetRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, data.userId))
    .limit(1);
  const targetUser = targetRows[0];
  if (!targetUser) {
    throw new Error("Account not found.");
  }

  if (caller.role === "admin") {
    const adminPerms = await getAdminPermsFromState();
    if (!adminPerms.includes("manage_users")) {
      throw new Error("Forbidden: You do not have permission to delete team accounts.");
    }
    if (targetUser.role !== "member" || targetUser.reportingAdminId !== caller.userId) {
      throw new Error(
        "Forbidden: Admins can only delete Team Member accounts that report directly to them.",
      );
    }
  }

  await db.delete(schema.users).where(eq(schema.users.id, data.userId));
  await db
    .update(schema.users)
    .set({ reportingAdminId: null })
    .where(eq(schema.users.reportingAdminId, data.userId));

  await syncUsersToPortalState();

  const { hasSupabaseAdminConfig } = await import("@/integrations/supabase/client.server");
  if (hasSupabaseAdminConfig()) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("profiles").delete().eq("id", data.userId);
    try {
      await supabaseAdmin.auth.admin.deleteUser(data.userId);
    } catch {
      /* ignore if missing in Supabase Auth */
    }
  }

  return { ok: true as const, deletedUserId: data.userId };
}

export async function saveAdminPermsRecord(
  caller: CallerContext,
  rawInput: unknown,
): Promise<{ ok: true }> {
  const data = SaveAdminPermsSchema.parse(rawInput);

  if (caller.role !== "super_admin") {
    throw new Error("Forbidden: Only a Super Admin can change admin permissions.");
  }

  const sanitizedPerms = data.perms.filter((p) => p !== "manage_admins");
  await ensurePortalInitialized();

  const rows = await db
    .select()
    .from(schema.portalState)
    .where(eq(schema.portalState.id, PORTAL_STATE_ID))
    .limit(1);

  if (rows[0]?.data) {
    const current = rows[0].data as AppState;
    await db
      .update(schema.portalState)
      .set({
        data: { ...current, adminPerms: sanitizedPerms },
        updatedAt: new Date(),
      })
      .where(eq(schema.portalState.id, PORTAL_STATE_ID));
  }

  const { hasSupabaseAdminConfig } = await import("@/integrations/supabase/client.server");
  if (hasSupabaseAdminConfig()) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "admin_perms", value: sanitizedPerms }, { onConflict: "key" });
  }

  return { ok: true as const };
}
