import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertPersistentStorageReady, db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { assertModuleAccess } from "./permissions.server.ts";
import { assertRateLimit } from "./rate-limit.server.ts";
import type { Role } from "./types.ts";

export const NoteInkSchema = z.enum([
  "charcoal",
  "purple",
  "crimson",
  "cobalt",
  "emerald",
  "amber",
  "magenta",
]);

export const NotePaperSchema = z.enum(["butter", "lavender", "mint", "peach", "sky"]);

export const CreateNoteInputSchema = z.object({
  title: z.string().trim().max(120).optional().default(""),
  content: z.string().trim().min(1, "Note content is required.").max(500),
  inkId: NoteInkSchema.optional().default("purple"),
  paperId: NotePaperSchema.optional().default("butter"),
  soundEnabled: z.boolean().optional().default(true),
  reminderAt: z.string().trim().max(64).nullable().optional().default(null),
});

export const UpdateNoteInputSchema = z.object({
  title: z.string().trim().max(120).optional(),
  content: z.string().trim().min(1, "Note content cannot be empty.").max(500).optional(),
  inkId: NoteInkSchema.optional(),
  paperId: NotePaperSchema.optional(),
  soundEnabled: z.boolean().optional(),
  reminderAt: z.string().trim().max(64).nullable().optional(),
  reminderTriggered: z.boolean().optional(),
  reminderDismissed: z.boolean().optional(),
});

export interface ServerNoteRecord {
  id: string;
  userId: string;
  title: string;
  content: string;
  inkId: z.infer<typeof NoteInkSchema>;
  paperId: z.infer<typeof NotePaperSchema>;
  soundEnabled: boolean;
  reminderAt: string | null;
  reminderTriggered: boolean;
  reminderDismissed: boolean;
  createdAt: string;
  updatedAt: string;
}

function normalizeReminderAt(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid reminder date and time.");
  }
  return d.toISOString();
}

function toNoteRecord(row: typeof schema.notes.$inferSelect): ServerNoteRecord {
  const parsedInk = NoteInkSchema.safeParse(row.inkId);
  const parsedPaper = NotePaperSchema.safeParse(row.paperId);
  return {
    id: row.id,
    userId: row.userId,
    title: row.title ?? "",
    content: row.content,
    inkId: parsedInk.success ? parsedInk.data : "purple",
    paperId: parsedPaper.success ? parsedPaper.data : "butter",
    soundEnabled: Boolean(row.soundEnabled),
    reminderAt: row.reminderAt ?? null,
    reminderTriggered: Boolean(row.reminderTriggered),
    reminderDismissed: Boolean(row.reminderDismissed),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listNotesForUser(caller: {
  userId: string;
  role: Role;
}): Promise<ServerNoteRecord[]> {
  await assertPersistentStorageReady();
  await assertModuleAccess(caller.userId, caller.role, "dashboard", "view");

  const rows = await db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.userId, caller.userId))
    .orderBy(asc(schema.notes.createdAt));

  return rows.map(toNoteRecord);
}

export async function createNoteForUser(
  caller: { userId: string; role: Role },
  rawInput: unknown,
): Promise<ServerNoteRecord> {
  assertRateLimit(`notes-write:${caller.userId}`, { limit: 60, windowMs: 60_000 });
  await assertPersistentStorageReady();
  await assertModuleAccess(caller.userId, caller.role, "dashboard", "edit");

  const parsed = CreateNoteInputSchema.parse(rawInput);
  const reminderAt = normalizeReminderAt(parsed.reminderAt);
  const nowIso = new Date().toISOString();
  const id = `note-${crypto.randomUUID().slice(0, 12)}`;

  const [inserted] = await db
    .insert(schema.notes)
    .values({
      id,
      userId: caller.userId,
      title: parsed.title,
      content: parsed.content,
      inkId: parsed.inkId,
      paperId: parsed.paperId,
      soundEnabled: parsed.soundEnabled,
      reminderAt,
      reminderTriggered: false,
      reminderDismissed: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .returning();

  if (!inserted) {
    throw new Error("Could not create note.");
  }
  return toNoteRecord(inserted);
}

export async function updateNoteForUser(
  caller: { userId: string; role: Role },
  noteId: string,
  rawInput: unknown,
): Promise<ServerNoteRecord> {
  assertRateLimit(`notes-write:${caller.userId}`, { limit: 120, windowMs: 60_000 });
  await assertPersistentStorageReady();

  const parsed = UpdateNoteInputSchema.parse(rawInput);
  const isOnlyAlertAck =
    parsed.title === undefined &&
    parsed.content === undefined &&
    parsed.inkId === undefined &&
    parsed.paperId === undefined &&
    parsed.soundEnabled === undefined &&
    (parsed.reminderTriggered !== undefined ||
      parsed.reminderDismissed !== undefined ||
      parsed.reminderAt !== undefined);

  // Users who can view dashboard may snooze/dismiss their own active reminder alerts;
  // full content edits require dashboard edit access.
  await assertModuleAccess(
    caller.userId,
    caller.role,
    "dashboard",
    isOnlyAlertAck ? "view" : "edit",
  );

  const existingRows = await db
    .select()
    .from(schema.notes)
    .where(and(eq(schema.notes.id, noteId), eq(schema.notes.userId, caller.userId)))
    .limit(1);

  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Note not found.");
  }

  const nextPatch: Partial<typeof schema.notes.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (parsed.title !== undefined) nextPatch.title = parsed.title;
  if (parsed.content !== undefined) nextPatch.content = parsed.content;
  if (parsed.inkId !== undefined) nextPatch.inkId = parsed.inkId;
  if (parsed.paperId !== undefined) nextPatch.paperId = parsed.paperId;
  if (parsed.soundEnabled !== undefined) nextPatch.soundEnabled = parsed.soundEnabled;

  if (parsed.reminderAt !== undefined) {
    const normalized = normalizeReminderAt(parsed.reminderAt);
    nextPatch.reminderAt = normalized;
    if (normalized !== existing.reminderAt) {
      nextPatch.reminderTriggered = parsed.reminderTriggered ?? false;
      nextPatch.reminderDismissed = parsed.reminderDismissed ?? false;
    }
  }

  if (parsed.reminderTriggered !== undefined) {
    nextPatch.reminderTriggered = parsed.reminderTriggered;
  }
  if (parsed.reminderDismissed !== undefined) {
    nextPatch.reminderDismissed = parsed.reminderDismissed;
  }

  const [updated] = await db
    .update(schema.notes)
    .set(nextPatch)
    .where(and(eq(schema.notes.id, noteId), eq(schema.notes.userId, caller.userId)))
    .returning();

  if (!updated) {
    throw new Error("Note not found.");
  }
  return toNoteRecord(updated);
}

export async function deleteNoteForUser(
  caller: { userId: string; role: Role },
  noteId: string,
): Promise<void> {
  assertRateLimit(`notes-write:${caller.userId}`, { limit: 60, windowMs: 60_000 });
  await assertPersistentStorageReady();
  await assertModuleAccess(caller.userId, caller.role, "dashboard", "edit");

  const deleted = await db
    .delete(schema.notes)
    .where(and(eq(schema.notes.id, noteId), eq(schema.notes.userId, caller.userId)))
    .returning({ id: schema.notes.id });

  if (deleted.length === 0) {
    throw new Error("Note not found.");
  }
}
