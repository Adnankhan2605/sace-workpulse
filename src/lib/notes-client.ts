import { getClientSessionToken } from "./portal-session-client";

export type PaperThemeId = "butter" | "lavender" | "mint" | "peach" | "sky";
export type InkColorId =
  "charcoal" | "purple" | "crimson" | "cobalt" | "emerald" | "amber" | "magenta";

export interface PortalNote {
  id: string;
  userId: string;
  title: string;
  content: string;
  inkId: InkColorId;
  paperId: PaperThemeId;
  soundEnabled: boolean;
  reminderAt: string | null;
  reminderTriggered: boolean;
  reminderDismissed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNotePayload {
  title?: string;
  content: string;
  inkId?: InkColorId;
  paperId?: PaperThemeId;
  soundEnabled?: boolean;
  reminderAt?: string | null;
}

export interface UpdateNotePayload {
  title?: string;
  content?: string;
  inkId?: InkColorId;
  paperId?: PaperThemeId;
  soundEnabled?: boolean;
  reminderAt?: string | null;
  reminderTriggered?: boolean;
  reminderDismissed?: boolean;
}

const NOTES_UPDATED_EVENT = "sace:notes-updated";

export function notifyNotesChanged(notes?: PortalNote[]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTES_UPDATED_EVENT, { detail: { notes } }));
}

export function subscribeNotesChanged(handler: (notes?: PortalNote[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const custom = e as CustomEvent<{ notes?: PortalNote[] }>;
    handler(custom.detail?.notes);
  };
  window.addEventListener(NOTES_UPDATED_EVENT, listener);
  return () => window.removeEventListener(NOTES_UPDATED_EVENT, listener);
}

async function notesFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getClientSessionToken();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (token) {
    headers.set("x-sace-session", token);
  }

  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });

  const payload = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(payload.error || `Request failed (${res.status}).`);
  }
  return payload;
}

export async function fetchNotesApi(): Promise<PortalNote[]> {
  const data = await notesFetch<{ ok: true; notes: PortalNote[] }>("/api/notes", {
    method: "GET",
  });
  return data.notes ?? [];
}

export async function createNoteApi(input: CreateNotePayload): Promise<PortalNote> {
  const data = await notesFetch<{ ok: true; note: PortalNote }>("/api/notes", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.note;
}

export async function updateNoteApi(noteId: string, input: UpdateNotePayload): Promise<PortalNote> {
  const data = await notesFetch<{ ok: true; note: PortalNote }>(
    `/api/notes/${encodeURIComponent(noteId)}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return data.note;
}

export async function deleteNoteApi(noteId: string): Promise<void> {
  await notesFetch<{ ok: true }>(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
  });
}

export function formatReminderLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toDatetimeLocalValue(isoOrLocal?: string | null): string {
  const date = isoOrLocal ? new Date(isoOrLocal) : new Date(Date.now() + 15 * 60 * 1000);
  const valid = Number.isNaN(date.getTime()) ? new Date(Date.now() + 15 * 60 * 1000) : date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(valid.getDate())}T${pad(valid.getHours())}:${pad(valid.getMinutes())}`;
}
