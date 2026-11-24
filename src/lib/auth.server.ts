import crypto from "node:crypto";
import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { eq, sql } from "drizzle-orm";
import { db, hasPostgresConfig } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { DEFAULT_ADMIN_PERMS, createSeedState } from "./seed.ts";
import type { AppState, Perm, Role, User } from "./types.ts";

export const SESSION_COOKIE_NAME = "sace_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours
const PORTAL_STATE_ID = "current_state";

const SUPER_ADMIN_EMAIL = "superadmin@sace.com";
const SUPER_ADMIN_USERNAME = "superadmin@sace.com";

declare global {
  var _ephemeralSessionSecret: string | undefined;
  var _portalInitPromise: Promise<void> | undefined;
}

function getSessionSecret(): string {
  const configured = process.env["AUTH_SESSION_SECRET"];
  if (configured && configured.length >= 32) {
    return configured;
  }
  if (!global._ephemeralSessionSecret) {
    if (process.env["NODE_ENV"] === "production") {
      console.warn(
        "[SACE Auth] AUTH_SESSION_SECRET is not set (>= 32 chars). Using ephemeral in-memory secret.",
      );
    }
    global._ephemeralSessionSecret = crypto.randomBytes(32).toString("hex");
  }
  return global._ephemeralSessionSecret;
}

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPasswordHash(
  plain: string,
  stored: string,
): {
  valid: boolean;
  needsRehash: boolean;
} {
  if (!plain || !stored) return { valid: false, needsRehash: false };

  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    if (parts.length !== 3) return { valid: false, needsRehash: false };
    const [, salt, expectedHex] = parts;
    if (!salt || !expectedHex) return { valid: false, needsRehash: false };
    const actualBuf = crypto.scryptSync(plain, salt, 64);
    const expectedBuf = Buffer.from(expectedHex, "hex");
    if (actualBuf.length !== expectedBuf.length) {
      return { valid: false, needsRehash: false };
    }
    return {
      valid: crypto.timingSafeEqual(actualBuf, expectedBuf),
      needsRehash: false,
    };
  }

  // Legacy plaintext migration support (rejects empty stored passwords)
  if (stored.trim().length === 0) return { valid: false, needsRehash: false };
  const a = Buffer.from(plain, "utf8");
  const b = Buffer.from(stored, "utf8");
  if (a.length !== b.length) return { valid: false, needsRehash: false };
  return {
    valid: crypto.timingSafeEqual(a, b),
    needsRehash: true,
  };
}

export function createSignedToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const nonce = crypto.randomBytes(12).toString("hex");
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp, nonce })).toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySignedToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, providedSig] = parts;
  if (!payload || !providedSig) return null;

  const expectedSig = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");

  const a = Buffer.from(providedSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
      exp?: unknown;
    };
    if (typeof decoded.sub !== "string" || typeof decoded.exp !== "number") return null;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded.sub;
  } catch {
    return null;
  }
}

function isHttpsRequest(): boolean {
  const req = getRequest();
  const proto = req?.headers?.get("x-forwarded-proto") ?? "";
  const origin = req?.headers?.get("origin") ?? "";
  return Boolean(
    proto.includes("https") || req?.url?.startsWith("https://") || origin.startsWith("https://"),
  );
}

export function setSessionCookie(userId: string, existingToken?: string): void {
  const token = existingToken ?? createSignedToken(userId);
  const isHttps = isHttpsRequest();
  setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? "none" : "lax",
    secure: isHttps,
    ...(isHttps ? { partitioned: true } : {}),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(): void {
  const isHttps = isHttpsRequest();
  deleteCookie(SESSION_COOKIE_NAME, {
    path: "/",
    sameSite: isHttps ? "none" : "lax",
    secure: isHttps,
  });
}

export function toPublicUser(row: typeof schema.users.$inferSelect): User {
  return {
    id: row.id,
    fullName: row.fullName,
    username: row.username,
    email: row.email,
    designation: row.designation,
    department: row.department,
    role: (row.role as Role) || "member",
    reportingAdminId: row.reportingAdminId,
    active: row.active,
    dailyVision: row.dailyVision,
    avatarColor: row.avatarColor,
    avatarUrl: row.avatarUrl,
    casualBalance: row.casualBalance,
    sickBalance: row.sickBalance,
  };
}

export function stripCredentialsFromUsers(list: User[]): User[] {
  return list.map((u) => {
    const copy = { ...u } as User & { password?: unknown };
    delete copy.password;
    return copy;
  });
}

async function ensurePostgresTablesExist(): Promise<void> {
  if (!hasPostgresConfig()) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "portal_state" (
      "id" text PRIMARY KEY NOT NULL,
      "data" jsonb NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "users" (
      "id" text PRIMARY KEY NOT NULL,
      "full_name" text NOT NULL,
      "username" text NOT NULL UNIQUE,
      "email" text NOT NULL UNIQUE,
      "password" text NOT NULL,
      "designation" text NOT NULL,
      "department" text NOT NULL,
      "role" text DEFAULT 'member' NOT NULL,
      "reporting_admin_id" text,
      "active" boolean DEFAULT true NOT NULL,
      "daily_vision" text,
      "avatar_color" text DEFAULT '#8B5CF6' NOT NULL,
      "avatar_url" text,
      "casual_balance" integer DEFAULT 12 NOT NULL,
      "sick_balance" integer DEFAULT 10 NOT NULL,
      "created_at" timestamp with time zone DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_smtp_configs" (
      "user_id" text PRIMARY KEY NOT NULL,
      "provider_label" text DEFAULT 'Custom SMTP' NOT NULL,
      "host" text DEFAULT '' NOT NULL,
      "port" integer DEFAULT 587 NOT NULL,
      "encryption" text DEFAULT 'starttls' NOT NULL,
      "username" text DEFAULT '' NOT NULL,
      "encrypted_password" text DEFAULT '' NOT NULL,
      "from_name" text DEFAULT '' NOT NULL,
      "from_email" text DEFAULT '' NOT NULL,
      "reply_to" text,
      "enabled" boolean DEFAULT true NOT NULL,
      "last_verified_at" text,
      "last_test_status" text,
      "last_test_error" text,
      "teams_webhook_encrypted" text,
      "teams_enabled" boolean DEFAULT false NOT NULL,
      "teams_last_verified_at" text,
      "teams_last_test_status" text,
      "teams_last_test_error" text,
      "updated_at" text NOT NULL
    )
  `);
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "teams_webhook_encrypted" text`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "teams_enabled" boolean DEFAULT false NOT NULL`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "teams_last_verified_at" text`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "teams_last_test_status" text`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "teams_last_test_error" text`,
  );
}

async function runPortalInitialization(): Promise<void> {
  await ensurePostgresTablesExist();

  const seedPassword = (process.env["SEED_DEFAULT_PASSWORD"] ?? "").trim();

  if (!seedPassword) {
    console.warn(
      "[SACE Auth] SEED_DEFAULT_PASSWORD is missing or empty — skipping Super Admin password sync; existing accounts remain intact.",
    );
  } else {
    const hashed = hashPassword(seedPassword);
    const existingUsers = await db.select({ id: schema.users.id }).from(schema.users).limit(1);

    if (existingUsers.length === 0) {
      const seedState = createSeedState();
      for (const u of seedState.users) {
        await db
          .insert(schema.users)
          .values({
            id: u.id,
            fullName: u.fullName,
            username: u.username.toLowerCase(),
            email: u.email.toLowerCase(),
            password: hashed,
            designation: u.designation,
            department: u.department,
            role: u.role,
            reportingAdminId: u.reportingAdminId,
            active: u.active,
            dailyVision: u.dailyVision,
            avatarColor: u.avatarColor,
            avatarUrl: u.avatarUrl ?? null,
            casualBalance: u.casualBalance,
            sickBalance: u.sickBalance,
          })
          .onConflictDoNothing();
      }
    }

    // Only upsert the configured system Super Admin account on startup without
    // deleting, truncating, or overwriting any other accounts in users.
    const existingSuperAdmin = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${SUPER_ADMIN_EMAIL}`)
      .limit(1);

    if (existingSuperAdmin[0]) {
      await db
        .update(schema.users)
        .set({
          email: SUPER_ADMIN_EMAIL,
          username: SUPER_ADMIN_USERNAME,
          password: hashed,
          role: "super_admin",
          active: true,
        })
        .where(eq(schema.users.id, existingSuperAdmin[0].id));
    } else {
      await db
        .insert(schema.users)
        .values({
          id: "u-superadmin",
          fullName: "Super Admin",
          username: SUPER_ADMIN_USERNAME,
          email: SUPER_ADMIN_EMAIL,
          password: hashed,
          designation: "Super Admin",
          department: "Executive",
          role: "super_admin",
          reportingAdminId: null,
          active: true,
          dailyVision: null,
          avatarColor: "#6b21a8",
          avatarUrl: null,
          casualBalance: 20,
          sickBalance: 12,
        })
        .onConflictDoUpdate({
          target: schema.users.email,
          set: {
            username: SUPER_ADMIN_USERNAME,
            password: hashed,
            role: "super_admin",
            active: true,
          },
        });
    }
  }

  const existingState = await db
    .select({ id: schema.portalState.id })
    .from(schema.portalState)
    .where(eq(schema.portalState.id, PORTAL_STATE_ID))
    .limit(1);

  if (existingState.length === 0) {
    const initial = createSeedState();
    initial.users = stripCredentialsFromUsers(initial.users);
    await db
      .insert(schema.portalState)
      .values({ id: PORTAL_STATE_ID, data: initial })
      .onConflictDoNothing();
  }
}

export async function ensurePortalInitialized(): Promise<void> {
  if (!global._portalInitPromise) {
    global._portalInitPromise = runPortalInitialization().catch((err) => {
      global._portalInitPromise = undefined;
      throw err;
    });
  }
  await global._portalInitPromise;
}

export async function getAdminPermsFromState(): Promise<Perm[]> {
  const rows = await db
    .select({ data: schema.portalState.data })
    .from(schema.portalState)
    .where(eq(schema.portalState.id, PORTAL_STATE_ID))
    .limit(1);
  const state = rows[0]?.data as Partial<AppState> | undefined;
  return Array.isArray(state?.adminPerms) ? state.adminPerms : DEFAULT_ADMIN_PERMS;
}

export async function resolveAuthenticatedUserFromRequest(req?: Request | null): Promise<{
  userId: string;
  role: Role;
  user: User;
} | null> {
  const sessionHeader = req?.headers?.get("x-sace-session")?.trim() ?? "";
  const cookieHeader = req?.headers?.get("cookie") ?? "";
  let cookieToken = "";
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const idx = part.indexOf("=");
      if (idx > 0 && part.slice(0, idx).trim() === SESSION_COOKIE_NAME) {
        cookieToken = decodeURIComponent(part.slice(idx + 1).trim());
        break;
      }
    }
  }

  let startCookie = "";
  try {
    startCookie = getCookie(SESSION_COOKIE_NAME) ?? "";
  } catch {
    // Outside TanStack request context
  }

  // 1. Check signed HttpOnly portal session cookie OR x-sace-session signed header
  const candidateToken = startCookie || cookieToken || sessionHeader;
  if (candidateToken) {
    const sub = verifySignedToken(candidateToken);
    if (sub) {
      const rows = await db.select().from(schema.users).where(eq(schema.users.id, sub)).limit(1);
      const userRow = rows[0];
      if (userRow && userRow.active) {
        return {
          userId: userRow.id,
          role: (userRow.role as Role) || "member",
          user: toPublicUser(userRow),
        };
      }
    }
  }

  // 2. Optionally verify Bearer JWT via Supabase if configured
  const supaUrl = process.env["SUPABASE_URL"];
  const supaKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (supaUrl && supaKey) {
    const authHeader = req?.headers?.get("authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim();
      if (token && token.split(".").length === 3) {
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(supaUrl, supaKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user?.id) {
          const rows = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, data.user.id))
            .limit(1);
          const userRow = rows[0];
          if (userRow && userRow.active) {
            return {
              userId: userRow.id,
              role: (userRow.role as Role) || "member",
              user: toPublicUser(userRow),
            };
          }
        }
      }
    }
  }

  return null;
}

export async function resolveAuthenticatedUser(): Promise<{
  userId: string;
  role: Role;
  user: User;
} | null> {
  return resolveAuthenticatedUserFromRequest(getRequest());
}

export function createMediaAccessToken(fileId: string): string {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(`msg-file:${fileId}`)
    .digest("base64url");
}

export function verifyMediaAccessToken(fileId: string, token: string): boolean {
  if (!fileId || !token) return false;
  const expected = createMediaAccessToken(fileId);
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
