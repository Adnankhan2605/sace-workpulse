import crypto from "node:crypto";
import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, hasPostgresConfig } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { checkRateLimit, getClientIpFromRequest } from "./rate-limit.server.ts";
import { PASSWORD_POLICY_ERROR, isStrongPassword } from "./security.ts";
import { DEFAULT_ADMIN_PERMS, createEmptyPortalState } from "./seed.ts";
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

function isHttpsFromRequest(req?: Request | null): boolean {
  const proto = req?.headers?.get("x-forwarded-proto") ?? "";
  const origin = req?.headers?.get("origin") ?? "";
  return Boolean(
    proto.includes("https") || req?.url?.startsWith("https://") || origin.startsWith("https://"),
  );
}

function isHttpsRequest(): boolean {
  try {
    return isHttpsFromRequest(getRequest());
  } catch {
    return false;
  }
}

export function buildSessionSetCookieHeader(token: string, req?: Request | null): string {
  const isHttps = isHttpsFromRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    isHttps ? "SameSite=None" : "SameSite=Lax",
  ];
  if (isHttps) {
    parts.push("Secure", "Partitioned");
  }
  return parts.join("; ");
}

export function buildClearSessionCookieHeader(req?: Request | null): string {
  const isHttps = isHttpsFromRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    isHttps ? "SameSite=None" : "SameSite=Lax",
  ];
  if (isHttps) {
    parts.push("Secure", "Partitioned");
  }
  return parts.join("; ");
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
  const rawMode = (row.workMode ?? "WFO").trim();
  const workMode = rawMode === "WFH" || rawMode === "Hybrid" ? rawMode : "WFO";
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
    casualBalance: row.casualBalance ?? 12,
    sickBalance: row.sickBalance ?? 12,
    shiftStartTime: row.shiftStartTime ?? null,
    shiftEndTime: row.shiftEndTime ?? null,
    weekOffs: Array.isArray(row.weekOffs) ? row.weekOffs : null,
    workMode,
    geoFenceMandatory: row.geoFenceMandatory ?? true,
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
      "sick_balance" integer DEFAULT 12 NOT NULL,
      "shift_start_time" text,
      "shift_end_time" text,
      "week_offs" jsonb,
      "work_mode" text DEFAULT 'WFO' NOT NULL,
      "geo_fence_mandatory" boolean DEFAULT true NOT NULL,
      "created_at" timestamp with time zone DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "shift_start_time" text`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "shift_end_time" text`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "week_offs" jsonb`);
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "work_mode" text DEFAULT 'WFO' NOT NULL`,
  );
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "geo_fence_mandatory" boolean DEFAULT true NOT NULL`,
  );
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
      "whatsapp_mode" text DEFAULT 'cloud_api' NOT NULL,
      "whatsapp_phone_number_id" text DEFAULT '' NOT NULL,
      "whatsapp_recipient_phone" text DEFAULT '' NOT NULL,
      "whatsapp_secret_encrypted" text,
      "whatsapp_enabled" boolean DEFAULT false NOT NULL,
      "whatsapp_last_verified_at" text,
      "whatsapp_last_test_status" text,
      "whatsapp_last_test_error" text,
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
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "whatsapp_mode" text DEFAULT 'cloud_api' NOT NULL`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "whatsapp_phone_number_id" text DEFAULT '' NOT NULL`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "whatsapp_recipient_phone" text DEFAULT '' NOT NULL`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "whatsapp_secret_encrypted" text`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "whatsapp_enabled" boolean DEFAULT false NOT NULL`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "whatsapp_last_verified_at" text`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "whatsapp_last_test_status" text`,
  );
  await db.execute(
    sql`ALTER TABLE "user_smtp_configs" ADD COLUMN IF NOT EXISTS "whatsapp_last_test_error" text`,
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "companies" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "code" text DEFAULT '' NOT NULL,
      "vertical" text DEFAULT '' NOT NULL,
      "description" text DEFAULT '' NOT NULL,
      "lead_user_id" text,
      "member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "active" boolean DEFAULT true NOT NULL,
      "created_by" text NOT NULL,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "initiatives" (
      "id" text PRIMARY KEY NOT NULL,
      "title" text NOT NULL,
      "description" text DEFAULT '' NOT NULL,
      "company_id" text,
      "battalion_id" text,
      "lead_user_id" text,
      "status" text DEFAULT 'on_track' NOT NULL,
      "progress" integer DEFAULT 0 NOT NULL,
      "due_date" text,
      "created_by" text NOT NULL,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL
    )
  `);
}

async function runStartupMigration(): Promise<void> {
  const { assertPersistentStorageReady } = await import("../db/index.ts");
  await assertPersistentStorageReady();
  await ensurePostgresTablesExist();

  const seedPassword = (process.env["SEED_DEFAULT_PASSWORD"] ?? "").trim();
  const initialSuperAdminHash = hashPassword(seedPassword || "SacePortal@2026!");

  // Strictly non-destructive: insert default Super Admin only if email does not exist yet
  await db
    .insert(schema.users)
    .values({
      id: "u-superadmin",
      fullName: "Super Admin",
      username: SUPER_ADMIN_USERNAME,
      email: SUPER_ADMIN_EMAIL,
      password: initialSuperAdminHash,
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
    .onConflictDoNothing({ target: schema.users.email });

  // Ensure initial empty portal_state row exists if brand new (never overwrite existing state)
  await db
    .insert(schema.portalState)
    .values({ id: PORTAL_STATE_ID, data: createEmptyPortalState() })
    .onConflictDoNothing({ target: schema.portalState.id });
}

export async function initializeDatabaseOnStartup(): Promise<void> {
  if (!hasPostgresConfig()) {
    console.info(
      "[SACE Startup] Waiting for DATABASE_URL in Workspace Secrets; startup table initialization skipped.",
    );
    return;
  }
  if (!global._portalInitPromise) {
    global._portalInitPromise = runStartupMigration().catch((err) => {
      global._portalInitPromise = undefined;
      console.error("[SACE Startup] Non-fatal PostgreSQL initialization error:", err);
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

  if (!hasPostgresConfig()) {
    return null;
  }

  // 1. Check signed HttpOnly portal session cookie OR x-sace-session signed header
  const candidateToken = startCookie || cookieToken || sessionHeader;
  if (candidateToken) {
    const sub = verifySignedToken(candidateToken);
    if (sub) {
      try {
        const rows = await db.select().from(schema.users).where(eq(schema.users.id, sub)).limit(1);
        const userRow = rows[0];
        if (userRow && userRow.active) {
          return {
            userId: userRow.id,
            role: (userRow.role as Role) || "member",
            user: toPublicUser(userRow),
          };
        }
      } catch (err) {
        console.error("[SACE Auth] Session user lookup failed:", err);
        return null;
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
        try {
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
        } catch (err) {
          console.error("[SACE Auth] Bearer session lookup failed:", err);
          return null;
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

export const LoginInputSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your username or email.").max(160),
  password: z.string().min(1, "Enter your password.").max(128),
});

export type PortalLoginResult =
  | { ok: true; status: 200; user: User; sessionToken: string }
  | { ok: false; status: 400 | 401 | 403 | 429 | 500 | 503; error: string };

export async function authenticatePortalLogin(
  rawInput: unknown,
  req?: Request | null,
): Promise<PortalLoginResult> {
  const parsed = LoginInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues[0]?.message ?? "Enter your username or email and password.",
    };
  }

  if (!hasPostgresConfig()) {
    return {
      ok: false,
      status: 503,
      error: "External PostgreSQL DATABASE_URL is not configured in Workspace Secrets.",
    };
  }

  const rawIdentifier = parsed.data.identifier.trim();
  const cleanIdentifier = rawIdentifier.toLowerCase();
  const clientIp = getClientIpFromRequest(req);
  const rateCheck = checkRateLimit(`login:${clientIp}:${cleanIdentifier}`, {
    limit: 8,
    windowMs: 5 * 60 * 1000,
    message: "Too many failed sign-in attempts. Please wait 5 minutes before retrying.",
  });
  if (!rateCheck.allowed) {
    return {
      ok: false,
      status: 429,
      error: rateCheck.message,
    };
  }

  try {
    await initializeDatabaseOnStartup();

    const rows = await db
      .select()
      .from(schema.users)
      .where(
        or(
          sql`lower(${schema.users.email}) = ${cleanIdentifier}`,
          sql`lower(${schema.users.username}) = ${cleanIdentifier}`,
          eq(schema.users.id, rawIdentifier),
        ),
      )
      .limit(1);

    const userRow = rows[0];
    if (!userRow) {
      return { ok: false, status: 401, error: "Invalid username/email or password." };
    }

    if (!userRow.active) {
      return { ok: false, status: 403, error: "This account is inactive. Contact your admin." };
    }

    const { valid, needsRehash } = verifyPasswordHash(parsed.data.password, userRow.password);
    if (!valid) {
      return { ok: false, status: 401, error: "Invalid username/email or password." };
    }

    // Automatically upgrade any legacy plaintext password to scrypt hash
    if (needsRehash) {
      await db
        .update(schema.users)
        .set({ password: hashPassword(parsed.data.password) })
        .where(eq(schema.users.id, userRow.id));
    }

    const sessionToken = createSignedToken(userRow.id);
    return {
      ok: true,
      status: 200,
      user: toPublicUser(userRow),
      sessionToken,
    };
  } catch (err) {
    console.error("[SACE Auth] Sign-in error:", err);
    return {
      ok: false,
      status: 500,
      error: "Unable to sign in right now. Please try again in a moment.",
    };
  }
}

export async function getAuthBootstrapStatus(): Promise<{
  ok: true;
  databaseConfigured: boolean;
  needsAdminSetup: boolean;
}> {
  if (!hasPostgresConfig()) {
    return { ok: true, databaseConfigured: false, needsAdminSetup: false };
  }
  try {
    await initializeDatabaseOnStartup();
    const countRows = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(ne(schema.users.id, "u-superadmin"));
    const nonSystemCount = Number(countRows[0]?.cnt ?? 0);
    return {
      ok: true,
      databaseConfigured: true,
      needsAdminSetup: nonSystemCount === 0,
    };
  } catch (err) {
    console.error("[SACE Auth] Bootstrap status check failed:", err);
    return { ok: true, databaseConfigured: true, needsAdminSetup: false };
  }
}

export const SetupInitialAdminSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(100),
  email: z.string().trim().email("Enter a valid email address.").max(160),
  password: z
    .string()
    .min(12, PASSWORD_POLICY_ERROR)
    .max(128)
    .refine(isStrongPassword, { message: PASSWORD_POLICY_ERROR }),
  designation: z.string().trim().max(100).optional(),
  department: z.string().trim().max(100).optional(),
});

export type SetupInitialAdminResult =
  | { ok: true; status: 201; user: User; sessionToken: string }
  | { ok: false; status: 400 | 403 | 409 | 429 | 500 | 503; error: string };

export async function setupInitialSuperAdminRecord(
  rawInput: unknown,
  req?: Request | null,
): Promise<SetupInitialAdminResult> {
  if (!hasPostgresConfig()) {
    return {
      ok: false,
      status: 503,
      error: "External PostgreSQL DATABASE_URL is not configured in Workspace Secrets.",
    };
  }

  const clientIp = getClientIpFromRequest(req);
  const rateCheck = checkRateLimit(`setup-admin:${clientIp}`, {
    limit: 10,
    windowMs: 15 * 60 * 1000,
    message: "Too many setup attempts. Please wait a few minutes before retrying.",
  });
  if (!rateCheck.allowed) {
    return { ok: false, status: 429, error: rateCheck.message };
  }

  const parsed = SetupInitialAdminSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues[0]?.message ?? "Please complete all required fields.",
    };
  }

  try {
    await initializeDatabaseOnStartup();
    const email = parsed.data.email.trim().toLowerCase();
    const base = (email.split("@")[0] ?? "admin").replace(/[^a-z0-9._-]/g, "") || "admin";

    const createdUser = await db.transaction(async (tx) => {
      const countRows = await tx
        .select({ cnt: sql<number>`count(*)::int` })
        .from(schema.users)
        .where(ne(schema.users.id, "u-superadmin"));
      if (Number(countRows[0]?.cnt ?? 0) > 0) {
        return { conflict: "already_claimed" as const };
      }

      const existingEmail = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(sql`lower(${schema.users.email}) = ${email}`)
        .limit(1);
      if (existingEmail.length > 0) {
        return { conflict: "email_exists" as const };
      }

      let username = base;
      for (let i = 1; i < 50; i += 1) {
        const taken = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(sql`lower(${schema.users.username}) = ${username}`)
          .limit(1);
        if (taken.length === 0) break;
        username = `${base}${i}`;
      }

      const newId = `u-${crypto.randomUUID().slice(0, 12)}`;
      const [inserted] = await tx
        .insert(schema.users)
        .values({
          id: newId,
          fullName: parsed.data.fullName.trim(),
          username,
          email,
          password: hashPassword(parsed.data.password),
          designation: (parsed.data.designation ?? "").trim() || "Super Admin",
          department: (parsed.data.department ?? "").trim() || "Executive",
          role: "super_admin",
          reportingAdminId: null,
          active: true,
          dailyVision: null,
          avatarColor: "#6b21a8",
          avatarUrl: null,
          casualBalance: 20,
          sickBalance: 12,
        })
        .returning();

      return { conflict: null, row: inserted };
    });

    if (createdUser.conflict === "already_claimed") {
      return {
        ok: false,
        status: 403,
        error: "Initial Super Admin setup is already completed. Please sign in with your account.",
      };
    }
    if (createdUser.conflict === "email_exists" || !createdUser.row) {
      return {
        ok: false,
        status: 409,
        error: "An account with this email already exists. Please sign in instead.",
      };
    }

    const sessionToken = createSignedToken(createdUser.row.id);
    return {
      ok: true,
      status: 201,
      user: toPublicUser(createdUser.row),
      sessionToken,
    };
  } catch (err) {
    console.error("[SACE Auth] Initial Super Admin setup failed:", err);
    return {
      ok: false,
      status: 500,
      error: "Unable to create the initial Super Admin account right now.",
    };
  }
}
