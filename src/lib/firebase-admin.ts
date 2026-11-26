import fs from "node:fs";
import path from "node:path";
import type { Auth } from "firebase-admin/auth";

let cachedAdminAuth: Auth | null = null;

function readFirebaseProjectId(): string | undefined {
  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (!fs.existsSync(configPath)) return undefined;
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as { projectId?: string };
    return raw.projectId;
  } catch {
    return undefined;
  }
}

export async function getAdminAuth(): Promise<Auth> {
  if (cachedAdminAuth) return cachedAdminAuth;
  const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/auth"),
  ]);
  if (!getApps().length) {
    const projectId = readFirebaseProjectId();
    initializeApp(projectId ? { projectId } : {});
  }
  cachedAdminAuth = getAuth();
  return cachedAdminAuth;
}
