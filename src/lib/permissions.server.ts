import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { assertPersistentStorageReady, db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { stripCredentialsFromUsers, toPublicUser } from "./auth.server.ts";
import {
  DEFAULT_ADMIN_MODULE_PERMISSIONS,
  DEFAULT_MEMBER_MODULE_PERMISSIONS,
  MODULE_KEYS,
  PORTAL_MODULE_MAP,
  createFullPermissionsMap,
  isModuleKey,
  normalizeModulePermission,
  resolveEffectivePermissions,
  type ModuleKey,
  type ModulePermission,
  type ModulePermissionsMap,
} from "./permissions.ts";
import { assertRateLimit } from "./rate-limit.server.ts";
import { createEmptyPortalState } from "./seed.ts";
import type { AppState, AuditLog, Role } from "./types.ts";

const PORTAL_STATE_ID = "current_state";
const HIDDEN_SYSTEM_EMAIL = "superadmin@sace.com";
const HIDDEN_SYSTEM_ID = "u-superadmin";

declare global {
  var _rolePermissionsSeedPromise: Promise<void> | undefined;
}

const ModulePermissionInputSchema = z.object({
  view: z.boolean(),
  edit: z.boolean(),
});

function buildModuleMapSchema() {
  const shape = {} as Record<ModuleKey, typeof ModulePermissionInputSchema>;
  for (const key of MODULE_KEYS) {
    shape[key] = ModulePermissionInputSchema;
  }
  return z.object(shape);
}

const ModuleMapSchema = buildModuleMapSchema();

export const SavePermissionsPayloadSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("role"),
    rolePermissions: z.object({
      admin: ModuleMapSchema,
      member: ModuleMapSchema,
    }),
  }),
  z.object({
    scope: z.literal("user"),
    userId: z.string().trim().min(1, "Select a user.").max(120),
    resetToDefault: z.boolean().optional(),
    permissions: ModuleMapSchema.optional(),
  }),
]);

export interface PermissionsWorkspaceUser {
  id: string;
  fullName: string;
  email: string;
  role: "admin" | "member";
  designation: string;
  department: string;
  active: boolean;
}

export interface PermissionsWorkspaceResponse {
  ok: true;
  rolePermissions: {
    admin: ModulePermissionsMap;
    member: ModulePermissionsMap;
  };
  userOverrides: Record<string, Partial<Record<ModuleKey, ModulePermission>>>;
  users: PermissionsWorkspaceUser[];
  myPermissions: ModulePermissionsMap;
}

export async function ensureRolePermissionsSeeded(): Promise<void> {
  if (!global._rolePermissionsSeedPromise) {
    global._rolePermissionsSeedPromise = (async () => {
      const nowIso = new Date().toISOString();
      const rows = [
        ...MODULE_KEYS.map((moduleKey) => ({
          role: "admin",
          moduleKey,
          canView: DEFAULT_ADMIN_MODULE_PERMISSIONS[moduleKey].view,
          canEdit: DEFAULT_ADMIN_MODULE_PERMISSIONS[moduleKey].edit,
          updatedAt: nowIso,
          updatedBy: "system",
        })),
        ...MODULE_KEYS.map((moduleKey) => ({
          role: "member",
          moduleKey,
          canView: DEFAULT_MEMBER_MODULE_PERMISSIONS[moduleKey].view,
          canEdit: DEFAULT_MEMBER_MODULE_PERMISSIONS[moduleKey].edit,
          updatedAt: nowIso,
          updatedBy: "system",
        })),
      ];

      await db
        .insert(schema.rolePermissions)
        .values(rows)
        .onConflictDoNothing({
          target: [schema.rolePermissions.role, schema.rolePermissions.moduleKey],
        });
    })().catch((err) => {
      global._rolePermissionsSeedPromise = undefined;
      throw err;
    });
  }
  await global._rolePermissionsSeedPromise;
}

export async function getRoleDefaultPermissionsFromDb(): Promise<{
  admin: ModulePermissionsMap;
  member: ModulePermissionsMap;
}> {
  await ensureRolePermissionsSeeded();
  const rows = await db
    .select()
    .from(schema.rolePermissions)
    .where(inArray(schema.rolePermissions.role, ["admin", "member"]));

  const adminPart: Partial<Record<ModuleKey, ModulePermission>> = {};
  const memberPart: Partial<Record<ModuleKey, ModulePermission>> = {};

  for (const row of rows) {
    if (!isModuleKey(row.moduleKey)) continue;
    const perm = normalizeModulePermission({ view: row.canView, edit: row.canEdit });
    if (row.role === "admin") {
      adminPart[row.moduleKey] = perm;
    } else if (row.role === "member") {
      memberPart[row.moduleKey] = perm;
    }
  }

  return {
    admin: resolveEffectivePermissions("admin", adminPart, null),
    member: resolveEffectivePermissions("member", memberPart, null),
  };
}

export async function getUserOverridesFromDb(
  userId: string,
): Promise<Partial<Record<ModuleKey, ModulePermission>>> {
  const rows = await db
    .select()
    .from(schema.userPermissionOverrides)
    .where(eq(schema.userPermissionOverrides.userId, userId));

  const overrides: Partial<Record<ModuleKey, ModulePermission>> = {};
  for (const row of rows) {
    if (!isModuleKey(row.moduleKey)) continue;
    overrides[row.moduleKey] = normalizeModulePermission({ view: row.canView, edit: row.canEdit });
  }
  return overrides;
}

export async function getEffectivePermissionsForUser(
  userId: string,
  role: Role,
): Promise<ModulePermissionsMap> {
  if (role === "super_admin") {
    return createFullPermissionsMap();
  }
  const [roleDefaults, overrides] = await Promise.all([
    getRoleDefaultPermissionsFromDb(),
    getUserOverridesFromDb(userId),
  ]);
  const baseDefaults = role === "admin" ? roleDefaults.admin : roleDefaults.member;
  return resolveEffectivePermissions(role, baseDefaults, overrides);
}

export async function hasModuleAccess(
  userId: string,
  role: Role,
  moduleKey: ModuleKey,
  level: "view" | "edit",
): Promise<boolean> {
  const perms = await getEffectivePermissionsForUser(userId, role);
  const mod = perms[moduleKey];
  return level === "edit" ? mod.edit : mod.view;
}

export async function assertModuleAccess(
  userId: string,
  role: Role,
  moduleKey: ModuleKey,
  level: "view" | "edit",
): Promise<ModulePermissionsMap> {
  const perms = await getEffectivePermissionsForUser(userId, role);
  const mod = perms[moduleKey];
  const allowed = level === "edit" ? mod.edit : mod.view;
  if (!allowed) {
    const label = PORTAL_MODULE_MAP[moduleKey]?.label ?? moduleKey;
    throw new Error(
      level === "edit"
        ? `Forbidden: View-Only access for ${label}. Editing is disabled for your account.`
        : `Forbidden: You do not have access to ${label}.`,
    );
  }
  return perms;
}

async function appendPermissionAudit(
  actorId: string,
  action: string,
  detail: string,
): Promise<void> {
  try {
    const [stateRows, userRows] = await Promise.all([
      db
        .select()
        .from(schema.portalState)
        .where(eq(schema.portalState.id, PORTAL_STATE_ID))
        .limit(1),
      db.select().from(schema.users),
    ]);
    const existing = (stateRows[0]?.data as AppState | undefined) ?? createEmptyPortalState();
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
    console.warn("[Permissions Audit] Audit append skipped:", err);
  }
}

export async function getPermissionsWorkspace(caller: {
  userId: string;
  role: Role;
}): Promise<PermissionsWorkspaceResponse> {
  await assertPersistentStorageReady();
  const [rolePermissions, myPermissions] = await Promise.all([
    getRoleDefaultPermissionsFromDb(),
    getEffectivePermissionsForUser(caller.userId, caller.role),
  ]);

  if (caller.role !== "super_admin") {
    return {
      ok: true,
      rolePermissions,
      userOverrides: {},
      users: [],
      myPermissions,
    };
  }

  const [overrideRows, userRows] = await Promise.all([
    db.select().from(schema.userPermissionOverrides),
    db.select().from(schema.users),
  ]);

  const userOverrides: Record<string, Partial<Record<ModuleKey, ModulePermission>>> = {};
  for (const row of overrideRows) {
    if (!isModuleKey(row.moduleKey)) continue;
    const map = (userOverrides[row.userId] ??= {});
    map[row.moduleKey] = normalizeModulePermission({ view: row.canView, edit: row.canEdit });
  }

  const users: PermissionsWorkspaceUser[] = userRows
    .map(toPublicUser)
    .filter((u) => {
      const email = (u.email ?? "").trim().toLowerCase();
      return (
        u.id !== HIDDEN_SYSTEM_ID &&
        email !== HIDDEN_SYSTEM_EMAIL &&
        (u.role === "admin" || u.role === "member")
      );
    })
    .map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role as "admin" | "member",
      designation: u.designation,
      department: u.department,
      active: u.active,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return {
    ok: true,
    rolePermissions,
    userOverrides,
    users,
    myPermissions,
  };
}

export async function savePermissionsUpdate(
  caller: { userId: string; role: Role },
  rawInput: unknown,
): Promise<PermissionsWorkspaceResponse> {
  if (caller.role !== "super_admin") {
    throw new Error("Forbidden: Only a Super Admin can modify module access permissions.");
  }

  assertRateLimit(`permissions-write:${caller.userId}`, { limit: 60, windowMs: 60_000 });
  await assertPersistentStorageReady();

  const parsed = SavePermissionsPayloadSchema.parse(rawInput);
  const nowIso = new Date().toISOString();

  if (parsed.scope === "role") {
    await db.transaction(async (tx) => {
      for (const roleKey of ["admin", "member"] as const) {
        const map = parsed.rolePermissions[roleKey];
        for (const moduleKey of MODULE_KEYS) {
          const normalized = normalizeModulePermission(map[moduleKey]);
          await tx
            .insert(schema.rolePermissions)
            .values({
              role: roleKey,
              moduleKey,
              canView: normalized.view,
              canEdit: normalized.edit,
              updatedAt: nowIso,
              updatedBy: caller.userId,
            })
            .onConflictDoUpdate({
              target: [schema.rolePermissions.role, schema.rolePermissions.moduleKey],
              set: {
                canView: normalized.view,
                canEdit: normalized.edit,
                updatedAt: nowIso,
                updatedBy: caller.userId,
              },
            });
        }
      }
    });

    await appendPermissionAudit(
      caller.userId,
      "role_permissions_updated",
      "Updated default Module Access Control Matrix for Admin and Team Member roles.",
    );

    return getPermissionsWorkspace(caller);
  }

  // Per-user override scope
  const targetRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, parsed.userId))
    .limit(1);
  const targetUser = targetRows[0];
  if (!targetUser) {
    throw new Error("Target user account was not found.");
  }
  if (targetUser.role === "super_admin") {
    throw new Error("Super Admin permissions are locked to full View + Edit access.");
  }

  if (parsed.resetToDefault) {
    await db
      .delete(schema.userPermissionOverrides)
      .where(eq(schema.userPermissionOverrides.userId, parsed.userId));

    await appendPermissionAudit(
      caller.userId,
      "user_permission_override_reset",
      `Reset module access permissions for ${targetUser.fullName} (${targetUser.email}) to ${targetUser.role} defaults.`,
    );

    return getPermissionsWorkspace(caller);
  }

  if (!parsed.permissions) {
    throw new Error("Module permissions map is required when saving user overrides.");
  }

  const nextMap = parsed.permissions;
  await db.transaction(async (tx) => {
    for (const moduleKey of MODULE_KEYS) {
      const normalized = normalizeModulePermission(nextMap[moduleKey]);
      await tx
        .insert(schema.userPermissionOverrides)
        .values({
          userId: parsed.userId,
          moduleKey,
          canView: normalized.view,
          canEdit: normalized.edit,
          updatedAt: nowIso,
          updatedBy: caller.userId,
        })
        .onConflictDoUpdate({
          target: [schema.userPermissionOverrides.userId, schema.userPermissionOverrides.moduleKey],
          set: {
            canView: normalized.view,
            canEdit: normalized.edit,
            updatedAt: nowIso,
            updatedBy: caller.userId,
          },
        });
    }
  });

  await appendPermissionAudit(
    caller.userId,
    "user_permission_override_updated",
    `Saved custom module access overrides for ${targetUser.fullName} (${targetUser.email}).`,
  );

  return getPermissionsWorkspace(caller);
}
