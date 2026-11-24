import { z } from "zod";
import type { MomDocument } from "./types";

export const MomActionItemSchema = z.object({
  id: z.string().min(1).max(64),
  task: z.string().max(1000),
  owner: z.string().max(160),
  deadline: z.string().max(80),
  status: z.enum(["Open", "In Progress", "Completed"]),
});

export const MomOverlaySchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["stamp", "signature"]),
  assetId: z.string().min(1).max(128),
  label: z.string().max(120),
  url: z.string().min(1).max(500),
  xPct: z.number().min(0).max(95),
  yPct: z.number().min(0).max(95),
  widthPct: z.number().min(6).max(60),
  rotation: z.number().min(-45).max(45),
  opacity: z.number().min(0.2).max(1),
});

export const SaveMomDocumentSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  title: z.string().trim().min(1, "Meeting title is required.").max(240),
  meetingDate: z.string().trim().min(4).max(32),
  meetingTime: z.string().max(64).optional(),
  location: z.string().max(160).optional(),
  department: z.string().max(120).optional(),
  sourceType: z.enum(["recording", "upload", "manual"]).default("manual"),
  sourceFileName: z.string().max(240).optional(),
  detectedLanguage: z.string().max(120).optional(),
  participants: z.array(z.string().max(120)).max(100).default([]),
  contentHtml: z.string().max(250_000),
  actionItems: z.array(MomActionItemSchema).max(200).default([]),
  verbatimTranscript: z.string().max(250_000).optional(),
  letterheadEnabled: z.boolean().default(false),
  letterheadAssetId: z.string().max(128).nullable().default(null),
  letterheadMode: z.enum(["header", "fullpage"]).optional(),
  overlays: z.array(MomOverlaySchema).max(40).default([]),
  visibility: z.enum(["private", "team", "selected"]).default("private"),
  sharedWithIds: z.array(z.string().max(80)).max(200).default([]),
});

export type SaveMomDocumentInput = z.infer<typeof SaveMomDocumentSchema>;

export const MAX_MOM_SOURCE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_MOM_ASSET_BYTES = 10 * 1024 * 1024; // 10 MB

export const SUPPORTED_MOM_SOURCE_ACCEPT =
  "audio/*,.mp3,.wav,.m4a,.webm,.ogg,.oga,.opus,.aac,.flac,.pdf,.doc,.docx,.txt,.md,.rtf,.csv,.png,.jpg,.jpeg,.webp";

export const LANGUAGE_HINTS = [
  { value: "auto", label: "Auto-detect (Any Language / Multilingual)" },
  { value: "English", label: "English" },
  { value: "Hindi", label: "Hindi / Hinglish" },
  { value: "Arabic", label: "Arabic" },
  { value: "Urdu", label: "Urdu" },
  { value: "Tamil", label: "Tamil" },
  { value: "Malayalam", label: "Malayalam" },
  { value: "Telugu", label: "Telugu" },
  { value: "Spanish", label: "Spanish" },
  { value: "French", label: "French" },
  { value: "German", label: "German" },
  { value: "Mandarin Chinese", label: "Mandarin Chinese" },
] as const;

export function createBlankMomTemplate(userId: string): MomDocument {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  return {
    id: `mom-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    title: "New Meeting Minutes",
    meetingDate: today,
    meetingTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    location: "Conference Room / Virtual",
    department: "General Operations",
    sourceType: "manual",
    detectedLanguage: "English",
    participants: [],
    contentHtml: `<h2>1. Executive Summary</h2>
<p>Summarize the core purpose and outcomes of this meeting here.</p>
<h2>2. Agenda &amp; Key Discussion Points</h2>
<ul>
  <li>Review ongoing milestones and operational priorities.</li>
  <li>Discuss blockers, timelines, and resource allocation.</li>
</ul>
<h2>3. Key Decisions Made</h2>
<ol>
  <li>Record finalized decisions and approvals here.</li>
</ol>
<h2>4. Next Steps &amp; Follow-Up</h2>
<p>Note the next scheduled check-in date and any pending clarifications.</p>`,
    actionItems: [
      {
        id: `ai-${Date.now()}`,
        task: "Circulate finalized MOM and confirm deliverables",
        owner: "Meeting Chair",
        deadline: today,
        status: "Open",
      },
    ],
    verbatimTranscript: "",
    letterheadEnabled: false,
    letterheadAssetId: null,
    letterheadMode: "header",
    overlays: [],
    visibility: "private",
    sharedWithIds: [],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Basic client/server HTML sanitizer allowing rich CMS formatting while stripping executable tags/attrs.
 */
export function sanitizeMomHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<(iframe|object|embed|form|input|button|meta|link)[\s\S]*?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export function formatFileBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

export async function parseJsonResponseSafe<T extends { ok?: boolean; error?: string }>(
  res: Response,
  fallbackError = "Request failed.",
): Promise<T> {
  const raw = await res.text();
  if (!raw.trim()) {
    throw new Error(`${fallbackError} (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    if (res.status === 413) {
      throw new Error("The uploaded file is too large for the server. Please try a smaller file.");
    }
    if (res.status === 504 || res.status === 502) {
      throw new Error(
        "The server took too long to process this file. Please try again with a shorter clip or smaller file.",
      );
    }
    throw new Error(
      `Server returned an unexpected response (HTTP ${res.status}). Please refresh the page and try again.`,
    );
  }
}
