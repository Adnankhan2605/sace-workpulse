import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

declare global {
  var _postgresPool: Pool | undefined;
}

export const MISSING_DATABASE_URL_ERROR =
  "Database configuration error: process.env.DATABASE_URL is missing. Configure your external PostgreSQL DATABASE_URL in Workspace Secrets.";

export function getDatabaseUrl(): string {
  return (process.env["DATABASE_URL"] ?? "").trim();
}

export function hasPostgresConfig(): boolean {
  return getDatabaseUrl().length > 0;
}

function resolveSslConfig(databaseUrl: string): false | { rejectUnauthorized: boolean } {
  if (/[?&]sslmode=disable\b/i.test(databaseUrl)) {
    return false;
  }
  return { rejectUnauthorized: false };
}

export const createPool = (): Pool | undefined => {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return undefined;
  }

  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 15000,
      ssl: resolveSslConfig(databaseUrl),
    });

    global._postgresPool.on("error", (err) => {
      console.error("[SACE DB] Unexpected error on idle PostgreSQL pool client:", err);
    });
  }
  return global._postgresPool;
};

function createUnconfiguredDbProxy(): ReturnType<typeof drizzle<typeof schema>> {
  const fail = () => {
    throw new Error(MISSING_DATABASE_URL_ERROR);
  };
  return new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
    get(_target, prop) {
      if (prop === "then" || typeof prop === "symbol") return undefined;
      return fail;
    },
  });
}

const pool = createPool();
export const db = pool ? drizzle(pool, { schema }) : createUnconfiguredDbProxy();
export { pool };

export async function assertPersistentStorageReady(): Promise<void> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(MISSING_DATABASE_URL_ERROR);
  }
  const activePool = createPool();
  if (!activePool) {
    throw new Error(MISSING_DATABASE_URL_ERROR);
  }
  try {
    await activePool.query("SELECT 1");
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Connection refused";
    throw new Error(
      `Database error: External PostgreSQL database is unreachable (${detail}). Verify your DATABASE_URL secret.`,
    );
  }
}

export interface DatabasePersistenceHealth {
  ok: true;
  connected: boolean;
  persistent: boolean;
  mode: "External PostgreSQL (Persistent)" | "Local/Ephemeral";
  sslEnabled: boolean;
  userCount: number;
  databaseHost: string | null;
  checkedAt: string;
  message: string;
}

function extractDatabaseHost(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname || null;
  } catch {
    return null;
  }
}

export async function getDatabasePersistenceHealth(): Promise<DatabasePersistenceHealth> {
  const checkedAt = new Date().toISOString();
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    return {
      ok: true,
      connected: false,
      persistent: false,
      mode: "Local/Ephemeral",
      sslEnabled: false,
      userCount: 0,
      databaseHost: null,
      checkedAt,
      message: MISSING_DATABASE_URL_ERROR,
    };
  }

  const sslEnabled = resolveSslConfig(databaseUrl) !== false;
  const databaseHost = extractDatabaseHost(databaseUrl);
  const activePool = createPool();
  if (!activePool) {
    return {
      ok: true,
      connected: false,
      persistent: false,
      mode: "Local/Ephemeral",
      sslEnabled,
      userCount: 0,
      databaseHost,
      checkedAt,
      message: MISSING_DATABASE_URL_ERROR,
    };
  }

  try {
    const countRes = await activePool.query<{ user_count: number }>(
      'SELECT COUNT(*)::int AS user_count FROM "users"',
    );
    const userCount = Number(countRes.rows[0]?.user_count ?? 0);
    return {
      ok: true,
      connected: true,
      persistent: true,
      mode: "External PostgreSQL (Persistent)",
      sslEnabled,
      userCount,
      databaseHost,
      checkedAt,
      message: "Connected to External PostgreSQL (Persistent).",
    };
  } catch (err) {
    console.error("[SACE DB] Health check failed:", err);
    return {
      ok: true,
      connected: false,
      persistent: false,
      mode: "Local/Ephemeral",
      sslEnabled,
      userCount: 0,
      databaseHost,
      checkedAt,
      message: "Unable to connect to External PostgreSQL. Verify DATABASE_URL and database tables.",
    };
  }
}
