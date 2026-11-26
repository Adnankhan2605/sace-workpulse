import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getTableColumns, type SQL, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

declare global {
  var _postgresPool: Pool | undefined;
  var _firestoreDb: Firestore | null | undefined;
  var _firestoreHydratedPromise: Promise<void> | undefined;
  var _firestoreReady: boolean | undefined;
  var _mockDbTables: Map<string, Map<string, Record<string, unknown>>> | undefined;
  var _mockDbLoadedMtimeMs: number | undefined;
  var _mockDbWarned: boolean | undefined;
}

const FIRESTORE_COLLECTIONS = [
  "users",
  "portal_state",
  "user_smtp_configs",
  "companies",
  "initiatives",
] as const;

export function hasPostgresConfig(): boolean {
  return Boolean(process.env["SQL_HOST"] && process.env["SQL_DB_NAME"] && process.env["SQL_USER"]);
}

function hasFirebaseAdminCredentials(): boolean {
  return Boolean(
    process.env["FIREBASE_SERVICE_ACCOUNT_JSON"]?.trim() ||
    process.env["GOOGLE_APPLICATION_CREDENTIALS"]?.trim(),
  );
}

function getFirestoreInstance(): Firestore | null {
  if (process.env["SACE_DB_FILE"]) {
    // Isolated local file test override
    return null;
  }
  if (global._firestoreDb !== undefined) {
    return global._firestoreDb;
  }
  if (!hasFirebaseAdminCredentials()) {
    global._firestoreDb = null;
    return null;
  }
  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (!fs.existsSync(configPath)) {
      global._firestoreDb = null;
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      projectId?: string;
      firestoreDatabaseId?: string;
    };
    if (!raw.projectId) {
      global._firestoreDb = null;
      return null;
    }
    const serviceAccountRaw = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"]?.trim();
    const existingApp = getApps()[0];
    const app =
      existingApp ??
      initializeApp(
        serviceAccountRaw
          ? {
              projectId: raw.projectId,
              credential: cert(JSON.parse(serviceAccountRaw) as ServiceAccount),
            }
          : { projectId: raw.projectId },
      );
    global._firestoreDb = raw.firestoreDatabaseId
      ? getFirestore(app, raw.firestoreDatabaseId)
      : getFirestore(app);
    global._firestoreDb.settings({ ignoreUndefinedProperties: true });
    return global._firestoreDb;
  } catch {
    global._firestoreDb = null;
    return null;
  }
}

function sanitizeForFirestore(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeForFirestore);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = sanitizeForFirestore(v);
      }
    }
    return out;
  }
  return value;
}

async function ensureFirestoreHydrated(
  store: Map<string, Map<string, Record<string, unknown>>>,
): Promise<void> {
  const firestore = getFirestoreInstance();
  if (!firestore) return;
  if (!global._firestoreHydratedPromise) {
    global._firestoreHydratedPromise = (async () => {
      try {
        let hydratedFromCloud = false;
        for (const colName of FIRESTORE_COLLECTIONS) {
          const snap = await firestore.collection(colName).get();
          let tableMap = store.get(colName);
          if (!tableMap) {
            tableMap = new Map();
            store.set(colName, tableMap);
          }
          if (!snap.empty) {
            for (const docSnap of snap.docs) {
              const data = docSnap.data() as Record<string, unknown>;
              tableMap.set(docSnap.id, data);
              hydratedFromCloud = true;
            }
          } else if (tableMap.size > 0) {
            const batch = firestore.batch();
            for (const [docId, row] of tableMap.entries()) {
              batch.set(
                firestore.collection(colName).doc(docId),
                sanitizeForFirestore(row) as Record<string, unknown>,
                { merge: true },
              );
            }
            await batch.commit();
          }
        }
        global._firestoreReady = true;
        if (hydratedFromCloud) {
          flushStoreToDisk(store);
        }
      } catch {
        // Disable Firestore Admin sync if container IAM lacks cross-project permission
        global._firestoreDb = null;
        global._firestoreReady = false;
      }
    })();
  }
  await global._firestoreHydratedPromise;
}

async function persistRowsToFirestore(
  tableName: string,
  rows: Array<{ id: string; row: Record<string, unknown> }>,
): Promise<void> {
  if (rows.length === 0) return;
  const firestore = getFirestoreInstance();
  if (!firestore) return;
  try {
    const batch = firestore.batch();
    for (const item of rows) {
      batch.set(
        firestore.collection(tableName).doc(item.id),
        sanitizeForFirestore(item.row) as Record<string, unknown>,
        { merge: true },
      );
    }
    await batch.commit();
    global._firestoreReady = true;
  } catch {
    global._firestoreDb = null;
    global._firestoreReady = false;
  }
}

async function deleteRowsFromFirestore(tableName: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const firestore = getFirestoreInstance();
  if (!firestore) return;
  try {
    const batch = firestore.batch();
    for (const id of ids) {
      batch.delete(firestore.collection(tableName).doc(id));
    }
    await batch.commit();
  } catch {
    global._firestoreDb = null;
    global._firestoreReady = false;
  }
}

export const createPool = () => {
  if (!hasPostgresConfig()) {
    return undefined;
  }
  if (!global._postgresPool) {
    const useSsl = process.env["SQL_SSL"] === "true";
    global._postgresPool = new Pool({
      host: process.env["SQL_HOST"],
      user: process.env["SQL_USER"],
      password: process.env["SQL_PASSWORD"],
      database: process.env["SQL_DB_NAME"],
      max: 10,
      connectionTimeoutMillis: 15000,
      ...(useSsl
        ? {
            ssl: {
              rejectUnauthorized: process.env["SQL_SSL_REJECT_UNAUTHORIZED"] !== "false",
            },
          }
        : {}),
    });

    global._postgresPool.on("error", (err) => {
      console.error("Unexpected error on idle SQL pool client:", err);
    });
  }
  return global._postgresPool;
};

function getPersistentFallbackPath(): string {
  const configured = (process.env["SACE_DB_FILE"] ?? "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), ".data", "sace-portal-db.json");
}

function hydrateStoreFromDisk(target: Map<string, Map<string, Record<string, unknown>>>): void {
  const filePath = getPersistentFallbackPath();
  try {
    if (!fs.existsSync(filePath)) {
      global._mockDbLoadedMtimeMs = 0;
      return;
    }
    const stat = fs.statSync(filePath);
    if (
      global._mockDbLoadedMtimeMs !== undefined &&
      stat.mtimeMs <= global._mockDbLoadedMtimeMs &&
      target.size > 0
    ) {
      return;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      global._mockDbLoadedMtimeMs = stat.mtimeMs;
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, Record<string, Record<string, unknown>>>;
    target.clear();
    for (const [tableName, rowsObj] of Object.entries(parsed)) {
      const tableMap = new Map<string, Record<string, unknown>>();
      if (rowsObj && typeof rowsObj === "object") {
        for (const [rowId, rowVal] of Object.entries(rowsObj)) {
          if (rowVal && typeof rowVal === "object") {
            tableMap.set(rowId, rowVal);
          }
        }
      }
      target.set(tableName, tableMap);
    }
    global._mockDbLoadedMtimeMs = stat.mtimeMs;
  } catch (err) {
    console.error("[SACE DB] Failed to load persistent fallback database:", err);
  }
}

function flushStoreToDisk(store: Map<string, Map<string, Record<string, unknown>>>): void {
  const filePath = getPersistentFallbackPath();
  const dir = path.dirname(filePath);
  const serializable: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [tableName, tableMap] of store.entries()) {
    const rowsObj: Record<string, Record<string, unknown>> = {};
    for (const [rowId, rowVal] of tableMap.entries()) {
      rowsObj[rowId] = rowVal;
    }
    serializable[tableName] = rowsObj;
  }
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tempPath, JSON.stringify(serializable), "utf8");
  fs.renameSync(tempPath, filePath);
  try {
    global._mockDbLoadedMtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    global._mockDbLoadedMtimeMs = Date.now();
  }
}

function getMockStore(): Map<string, Map<string, Record<string, unknown>>> {
  if (!global._mockDbTables) {
    global._mockDbTables = new Map();
  }
  hydrateStoreFromDisk(global._mockDbTables);
  return global._mockDbTables;
}

function getTableName(table: Table): string {
  const symName = (table as unknown as Record<symbol, unknown>)[Symbol.for("drizzle:Name")];
  if (typeof symName === "string") return symName;
  const orig = (table as unknown as { _?: { name?: string } })?._?.name;
  return orig || "default";
}

function getTableRows(table: Table): Map<string, Record<string, unknown>> {
  const store = getMockStore();
  const name = getTableName(table);
  let rows = store.get(name);
  if (!rows) {
    rows = new Map();
    store.set(name, rows);
  }
  return rows;
}

function buildSqlToJsColumnMap(table: Table): Map<string, string> {
  const map = new Map<string, string>();
  const cols = getTableColumns(table);
  for (const [jsKey, col] of Object.entries(cols)) {
    map.set(col.name, jsKey);
  }
  return map;
}

interface SqlLike {
  queryChunks?: unknown[];
}

function isSqlLike(val: unknown): val is SqlLike {
  return Boolean(val && typeof val === "object" && Array.isArray((val as SqlLike).queryChunks));
}

function extractComparisonTarget(chunks: unknown[]): {
  colName?: string;
  paramVal?: unknown;
  hasParam: boolean;
  isLower: boolean;
} {
  let colName: string | undefined;
  let paramVal: unknown;
  let hasParam = false;
  let isLower = false;

  for (const chunk of chunks) {
    if (typeof chunk === "string" || typeof chunk === "number" || typeof chunk === "boolean") {
      paramVal = chunk;
      hasParam = true;
      continue;
    }
    if (chunk === null) {
      paramVal = null;
      hasParam = true;
      continue;
    }
    if (!chunk || typeof chunk !== "object") continue;
    if (isSqlLike(chunk) && chunk.queryChunks) {
      const sub = extractComparisonTarget(chunk.queryChunks);
      if (sub.colName && !colName) colName = sub.colName;
      if (sub.isLower) isLower = true;
      if (sub.hasParam && !hasParam) {
        paramVal = sub.paramVal;
        hasParam = true;
      }
      continue;
    }
    const rec = chunk as { name?: unknown; value?: unknown };
    if (Array.isArray(rec.value)) {
      const text = rec.value.join("").toLowerCase();
      if (text.includes("lower(")) isLower = true;
    } else if (typeof rec.name === "string") {
      colName = rec.name;
    } else if ("value" in rec) {
      paramVal = rec.value;
      hasParam = true;
    }
  }

  return {
    ...(colName !== undefined ? { colName } : {}),
    ...(hasParam ? { paramVal } : {}),
    hasParam,
    isLower,
  };
}

function matchesWhereExpr(
  row: Record<string, unknown>,
  expr: unknown,
  sqlToJs: Map<string, string>,
): boolean {
  if (!expr) return true;
  if (!isSqlLike(expr) || !expr.queryChunks) return true;

  const chunks = expr.queryChunks;
  // Check if this SQL node is an OR / AND combinator of nested SQL nodes
  const nestedSqls = chunks.filter(isSqlLike);
  const stringChunks = chunks
    .filter((c): c is { value: string[] } =>
      Boolean(c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value)),
    )
    .flatMap((c) => c.value);

  const joined = stringChunks.join(" ").toLowerCase();
  if (nestedSqls.length > 0 && (joined.includes(" or ") || joined.includes(" and "))) {
    if (joined.includes(" or ")) {
      return nestedSqls.some((sub) => matchesWhereExpr(row, sub, sqlToJs));
    }
    return nestedSqls.every((sub) => matchesWhereExpr(row, sub, sqlToJs));
  }

  // Leaf comparison: e.g. eq(col, param) or sql`lower(${col}) = ${val}`
  const { colName, paramVal, hasParam, isLower } = extractComparisonTarget(chunks);
  if (colName && hasParam) {
    const jsKey = sqlToJs.get(colName) ?? colName;
    const rowVal = row[jsKey];
    if (isLower) {
      return String(rowVal ?? "").toLowerCase() === String(paramVal ?? "").toLowerCase();
    }
    return rowVal === paramVal;
  }

  if (nestedSqls.length > 0) {
    return nestedSqls.every((sub) => matchesWhereExpr(row, sub, sqlToJs));
  }

  return true;
}

function resolveTargetKeys(target: unknown, sqlToJs: Map<string, string>): string[] {
  if (!target) return ["id"];
  const items = Array.isArray(target) ? target : [target];
  const keys: string[] = [];
  for (const col of items) {
    if (col && typeof col === "object") {
      const rec = col as { name?: unknown };
      if (typeof rec.name === "string") {
        keys.push(sqlToJs.get(rec.name) ?? rec.name);
      }
    }
  }
  return keys.length > 0 ? keys : ["id"];
}

function projectRow(
  row: Record<string, unknown>,
  selection?: Record<string, unknown>,
): Record<string, unknown> {
  if (!selection) return { ...row };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(selection)) {
    out[key] = row[key];
  }
  return out;
}

function createPersistentFallbackDb() {
  if (!global._mockDbWarned) {
    global._mockDbWarned = true;
    const firestore = getFirestoreInstance();
    console.info(
      firestore
        ? `[SACE DB] Connected to Cloud Firestore + persistent local store at ${getPersistentFallbackPath()}.`
        : `[SACE DB] Using persistent file-backed database at ${getPersistentFallbackPath()}.`,
    );
  }

  return {
    select(selection?: Record<string, unknown>) {
      return {
        from(table: Table) {
          const sqlToJs = buildSqlToJsColumnMap(table);
          let whereExpr: unknown;
          let limitCount: number | undefined;

          const run = async () => {
            const store = getMockStore();
            await ensureFirestoreHydrated(store);
            const rows = Array.from(getTableRows(table).values());
            const filtered = whereExpr
              ? rows.filter((r) => matchesWhereExpr(r, whereExpr, sqlToJs))
              : rows;
            const sliced =
              typeof limitCount === "number" ? filtered.slice(0, limitCount) : filtered;
            return sliced.map((r) => projectRow(r, selection));
          };

          const builder = {
            where(expr: unknown) {
              whereExpr = expr;
              return builder;
            },
            limit(n: number) {
              limitCount = n;
              return builder;
            },
            then<TResult1 = Record<string, unknown>[], TResult2 = never>(
              onfulfilled?:
                ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return run().then(onfulfilled, onrejected);
            },
          };

          return builder;
        },
      };
    },

    insert(table: Table) {
      const sqlToJs = buildSqlToJsColumnMap(table);
      const tableName = getTableName(table);
      return {
        values(rawValues: Record<string, unknown> | Record<string, unknown>[]) {
          const items = Array.isArray(rawValues) ? rawValues : [rawValues];
          let mode: "error" | "ignore" | "update" = "error";
          let conflictTarget: unknown;
          let updateSet: Record<string, unknown> | undefined;
          let returnSelection: Record<string, unknown> | undefined | null = null;

          const run = async () => {
            const store = getMockStore();
            await ensureFirestoreHydrated(store);
            const tableMap = getTableRows(table);
            const affected: Record<string, unknown>[] = [];
            const firestoreUpserts: Array<{ id: string; row: Record<string, unknown> }> = [];
            let mutated = false;

            for (const item of items) {
              const row = { ...item };
              const id =
                tableName === "user_smtp_configs"
                  ? String(row["userId"] ?? crypto.randomUUID())
                  : String(row["id"] ?? crypto.randomUUID());
              if (tableName !== "user_smtp_configs") {
                row["id"] = id;
              }
              if (tableName === "users" && !row["createdAt"]) {
                row["createdAt"] = new Date().toISOString();
              }

              let conflictKey: string | undefined;
              if (mode === "update" && conflictTarget) {
                const targetKeys = resolveTargetKeys(conflictTarget, sqlToJs);
                for (const [existingId, existingRow] of tableMap.entries()) {
                  const matched = targetKeys.every((k) => {
                    if (row[k] === undefined || row[k] === null) return false;
                    if (k === "email" || k === "username") {
                      return (
                        String(existingRow[k] ?? "").toLowerCase() === String(row[k]).toLowerCase()
                      );
                    }
                    return existingRow[k] === row[k];
                  });
                  if (matched) {
                    conflictKey = existingId;
                    break;
                  }
                }
              } else if (tableMap.has(id)) {
                conflictKey = id;
              } else if (mode === "ignore" && conflictTarget) {
                const targetKeys = resolveTargetKeys(conflictTarget, sqlToJs);
                for (const [existingId, existingRow] of tableMap.entries()) {
                  const matched = targetKeys.every((k) => {
                    if (row[k] === undefined || row[k] === null) return false;
                    if (k === "email" || k === "username") {
                      return (
                        String(existingRow[k] ?? "").toLowerCase() === String(row[k]).toLowerCase()
                      );
                    }
                    return existingRow[k] === row[k];
                  });
                  if (matched) {
                    conflictKey = existingId;
                    break;
                  }
                }
              }

              if (mode === "error") {
                if (conflictKey !== undefined) {
                  throw new Error(`Duplicate primary key "${id}" in table "${tableName}".`);
                }
                if (tableName === "users") {
                  const nextEmail = String(row["email"] ?? "").toLowerCase();
                  const nextUsername = String(row["username"] ?? "").toLowerCase();
                  for (const existingRow of tableMap.values()) {
                    if (
                      nextEmail &&
                      String(existingRow["email"] ?? "").toLowerCase() === nextEmail
                    ) {
                      throw new Error(`Duplicate email "${nextEmail}" in users table.`);
                    }
                    if (
                      nextUsername &&
                      String(existingRow["username"] ?? "").toLowerCase() === nextUsername
                    ) {
                      throw new Error(`Duplicate username "${nextUsername}" in users table.`);
                    }
                  }
                }
              }

              if (conflictKey !== undefined) {
                if (mode === "ignore") continue;
                if (mode === "update" && updateSet) {
                  const merged = { ...tableMap.get(conflictKey), ...updateSet };
                  tableMap.set(conflictKey, merged);
                  affected.push(merged);
                  firestoreUpserts.push({ id: conflictKey, row: merged });
                  mutated = true;
                  continue;
                }
              }

              tableMap.set(id, row);
              affected.push(row);
              firestoreUpserts.push({ id, row });
              mutated = true;
            }

            if (mutated) {
              flushStoreToDisk(store);
              await persistRowsToFirestore(tableName, firestoreUpserts);
            }
            if (returnSelection === null) {
              return [];
            }
            return affected.map((r) => projectRow(r, returnSelection ?? undefined));
          };

          const builder = {
            onConflictDoNothing(opts?: { target?: unknown }) {
              mode = "ignore";
              conflictTarget = opts?.target;
              return builder;
            },
            onConflictDoUpdate(opts: { target: unknown; set: Record<string, unknown> }) {
              mode = "update";
              conflictTarget = opts.target;
              updateSet = opts.set;
              return builder;
            },
            returning(selection?: Record<string, unknown>) {
              returnSelection = selection;
              return builder;
            },
            then<TResult1 = unknown[], TResult2 = never>(
              onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return run().then(onfulfilled, onrejected);
            },
          };

          return builder;
        },
      };
    },

    update(table: Table) {
      const sqlToJs = buildSqlToJsColumnMap(table);
      const tableName = getTableName(table);
      return {
        set(patch: Record<string, unknown>) {
          let whereExpr: unknown;
          let returnSelection: Record<string, unknown> | undefined | null = null;
          const run = async () => {
            const store = getMockStore();
            await ensureFirestoreHydrated(store);
            const tableMap = getTableRows(table);
            const affected: Record<string, unknown>[] = [];
            const firestoreUpserts: Array<{ id: string; row: Record<string, unknown> }> = [];
            let mutated = false;
            for (const [id, row] of tableMap.entries()) {
              if (!whereExpr || matchesWhereExpr(row, whereExpr, sqlToJs)) {
                const updated = { ...row, ...patch };
                tableMap.set(id, updated);
                affected.push(updated);
                firestoreUpserts.push({ id, row: updated });
                mutated = true;
              }
            }
            if (mutated) {
              flushStoreToDisk(store);
              await persistRowsToFirestore(tableName, firestoreUpserts);
            }
            if (returnSelection === null) {
              return [];
            }
            return affected.map((r) => projectRow(r, returnSelection ?? undefined));
          };
          const builder = {
            where(expr: unknown) {
              whereExpr = expr;
              return builder;
            },
            returning(selection?: Record<string, unknown>) {
              returnSelection = selection;
              return builder;
            },
            then<TResult1 = unknown[], TResult2 = never>(
              onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return run().then(onfulfilled, onrejected);
            },
          };
          return builder;
        },
      };
    },

    delete(table: Table) {
      const sqlToJs = buildSqlToJsColumnMap(table);
      const tableName = getTableName(table);
      let whereExpr: unknown;
      const run = async () => {
        const store = getMockStore();
        await ensureFirestoreHydrated(store);
        const tableMap = getTableRows(table);
        const deletedIds: string[] = [];
        let mutated = false;
        for (const [id, row] of tableMap.entries()) {
          if (!whereExpr || matchesWhereExpr(row, whereExpr, sqlToJs)) {
            tableMap.delete(id);
            deletedIds.push(id);
            mutated = true;
          }
        }
        if (mutated) {
          flushStoreToDisk(store);
          await deleteRowsFromFirestore(tableName, deletedIds);
        }
        return [];
      };
      const builder = {
        where(expr: unknown) {
          whereExpr = expr;
          return builder;
        },
        then<TResult1 = unknown[], TResult2 = never>(
          onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return run().then(onfulfilled, onrejected);
        },
      };
      return builder;
    },

    async execute(_query: SQL) {
      return { rows: [{ "?column?": 1 }] };
    },
  } as unknown as ReturnType<typeof drizzle<typeof schema>>;
}

const pool = createPool();
export const db = pool ? drizzle(pool, { schema }) : createPersistentFallbackDb();
export { pool };

export async function assertPersistentStorageReady(): Promise<void> {
  if (hasPostgresConfig()) {
    if (!pool) {
      throw new Error(
        "Database error: PostgreSQL configuration is incomplete. Unable to persist account.",
      );
    }
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Connection refused";
      throw new Error(
        `Database error: Persistent SQL database is unreachable (${detail}). Account creation aborted to prevent data loss.`,
      );
    }
    return;
  }

  const filePath = getPersistentFallbackPath();
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Storage directory is not writable";
    throw new Error(
      `Database error: Persistent database storage at ${filePath} is unavailable (${detail}). Account creation aborted to prevent data loss.`,
    );
  }
}
