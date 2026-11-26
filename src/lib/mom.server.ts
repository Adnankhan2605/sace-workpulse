import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import {
  createMediaAccessToken,
  ensurePortalInitialized,
  stripCredentialsFromUsers,
  toPublicUser,
  verifyMediaAccessToken,
} from "./auth.server.ts";
import {
  MAX_MOM_ASSET_BYTES,
  MAX_MOM_SOURCE_BYTES,
  SaveMomDocumentSchema,
  sanitizeMomHtml,
} from "./mom.ts";
import { assertRateLimit } from "./rate-limit.server.ts";
import { createSeedState } from "./seed.ts";
import type {
  AppNotification,
  AppState,
  AuditLog,
  MomActionItem,
  MomBrandAsset,
  MomDocument,
  Role,
} from "./types.ts";

const PORTAL_STATE_ID = "current_state";
const MOM_ASSETS_ROOT = path.resolve(process.cwd(), ".sace-uploads", "mom-assets");

const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

const AUDIO_EXTENSIONS = new Set([
  ".webm",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".oga",
  ".aac",
  ".flac",
  ".mp4",
  ".opus",
]);

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"] || "").trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured on the server. Open Settings > Secrets in Google AI Studio, add GEMINI_API_KEY with your Gemini API key, and try generating the MOM again.",
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function extractGeminiErrorInfo(err: unknown): {
  code?: number;
  status?: string;
  message: string;
} {
  const raw = err instanceof Error ? err.message : String(err ?? "AI generation failed.");
  const rec = err as { status?: unknown; code?: unknown } | null;
  const numericStatus = typeof rec?.status === "number" ? rec.status : undefined;
  const numericCode = typeof rec?.code === "number" ? rec.code : numericStatus;

  try {
    const start = raw.indexOf("{");
    if (start >= 0) {
      const parsed = JSON.parse(raw.slice(start)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      if (parsed.error) {
        return {
          ...(typeof parsed.error.code === "number"
            ? { code: parsed.error.code }
            : numericCode !== undefined
              ? { code: numericCode }
              : {}),
          ...(parsed.error.status ? { status: parsed.error.status } : {}),
          message: parsed.error.message || raw,
        };
      }
    }
  } catch {
    // Fall back to raw error message
  }

  return {
    ...(numericCode !== undefined ? { code: numericCode } : {}),
    message: raw,
  };
}

function isNonRetryableAuthError(err: unknown): boolean {
  const info = extractGeminiErrorInfo(err);
  const msg = info.message.toLowerCase();
  return (
    info.code === 403 ||
    info.status === "PERMISSION_DENIED" ||
    msg.includes("permission_denied") ||
    msg.includes("api_key_invalid") ||
    msg.includes("api key not valid")
  );
}

function isTransientOverloadError(err: unknown): boolean {
  const info = extractGeminiErrorInfo(err);
  const msg = info.message.toLowerCase();
  return (
    info.code === 503 ||
    info.code === 429 ||
    info.code === 500 ||
    info.code === 504 ||
    info.status === "UNAVAILABLE" ||
    info.status === "RESOURCE_EXHAUSTED" ||
    info.status === "INTERNAL" ||
    info.status === "DEADLINE_EXCEEDED" ||
    msg.includes("high demand") ||
    msg.includes("spikes in demand") ||
    msg.includes("overloaded") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("unavailable") ||
    msg.includes("resource_exhausted") ||
    msg.includes("too many requests") ||
    msg.includes("try again later") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

function isModelUnavailableError(err: unknown, model: string): boolean {
  const info = extractGeminiErrorInfo(err);
  const msg = info.message;
  if (
    info.code === 404 ||
    info.status === "NOT_FOUND" ||
    msg.includes("NOT_FOUND") ||
    msg.includes("404") ||
    msg.includes("is not found") ||
    msg.includes("not supported for generateContent")
  ) {
    return true;
  }
  // If specialized transcribe model rejects a container format (e.g., WhatsApp .ogg / opus), let multimodal Gemini models decode it
  if (
    model === "gemini-3.5-transcribe" &&
    (info.code === 400 ||
      info.status === "INVALID_ARGUMENT" ||
      msg.includes("INVALID_ARGUMENT") ||
      msg.includes("400") ||
      msg.includes("Unsupported"))
  ) {
    return true;
  }
  return false;
}

function formatGeminiError(err: unknown): Error {
  const info = extractGeminiErrorInfo(err);
  const lower = info.message.toLowerCase();

  if (isNonRetryableAuthError(err)) {
    return new Error(
      "API key permission denied or invalid. Please check your API key in Settings > Secrets.",
    );
  }
  if (
    info.code === 429 ||
    info.status === "RESOURCE_EXHAUSTED" ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota")
  ) {
    return new Error(
      "API rate limit or quota reached. Please wait a moment and try again, or check your API key tier in Settings > Secrets.",
    );
  }
  if (
    info.code === 503 ||
    info.status === "UNAVAILABLE" ||
    lower.includes("high demand") ||
    lower.includes("overloaded") ||
    lower.includes("temporarily")
  ) {
    return new Error(
      "The AI service is temporarily experiencing high demand across available models. Please wait a few seconds and click Generate MOM again.",
    );
  }
  return new Error(info.message || "AI generation failed.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithModelFallback(
  ai: GoogleGenAI,
  models: string[],
  requestParams: Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">,
) {
  let lastErr: unknown;
  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    const maxAttemptsForModel = 2;

    for (let attempt = 1; attempt <= maxAttemptsForModel; attempt++) {
      try {
        return await ai.models.generateContent({
          model,
          ...requestParams,
        });
      } catch (err) {
        lastErr = err;
        if (isNonRetryableAuthError(err)) {
          throw formatGeminiError(err);
        }

        if (isModelUnavailableError(err, model)) {
          if (i < models.length - 1) {
            console.warn(
              `[MOM] Model "${model}" unavailable/incompatible, switching to "${models[i + 1]}"...`,
            );
            break;
          }
          throw formatGeminiError(err);
        }

        if (isTransientOverloadError(err)) {
          if (attempt < maxAttemptsForModel) {
            const backoffMs = 800 * attempt + Math.floor(Math.random() * 350);
            console.warn(
              `[MOM] Model "${model}" busy (attempt ${attempt}/${maxAttemptsForModel}), retrying in ${backoffMs}ms...`,
            );
            await sleep(backoffMs);
            continue;
          }
          if (i < models.length - 1) {
            console.warn(
              `[MOM] Model "${model}" still experiencing high demand, falling back to "${models[i + 1]}"...`,
            );
            break;
          }
        }

        throw formatGeminiError(err);
      }
    }
  }
  throw formatGeminiError(lastErr);
}

function parseJsonResponse<T>(rawText: string | undefined): T {
  const cleaned = (rawText ?? "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) {
    throw new Error("The AI returned an empty response. Please try generating again.");
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error("The AI returned an incomplete MOM structure. Please try generating again.");
  }
}

async function loadPortalStateAndUsers() {
  await ensurePortalInitialized();
  const [stateRows, userRows] = await Promise.all([
    db.select().from(schema.portalState).where(eq(schema.portalState.id, PORTAL_STATE_ID)).limit(1),
    db.select().from(schema.users),
  ]);
  const existing = (stateRows[0]?.data as AppState | undefined) ?? createSeedState();
  const publicUsers = userRows.map(toPublicUser);
  return { existing, publicUsers };
}

async function persistPortalState(nextState: AppState) {
  await db
    .insert(schema.portalState)
    .values({ id: PORTAL_STATE_ID, data: nextState })
    .onConflictDoUpdate({
      target: schema.portalState.id,
      set: { data: nextState, updatedAt: new Date() },
    });
}

function canUserReadMom(doc: MomDocument, userId: string, role: Role): boolean {
  if (doc.createdBy === userId) return true;
  if (doc.visibility === "team") return true;
  if (doc.visibility === "selected" && doc.sharedWithIds.includes(userId)) return true;
  if (role === "super_admin" && doc.visibility !== "private") return true;
  return false;
}

function canUserModifyMom(doc: MomDocument, userId: string, role: Role): boolean {
  if (doc.createdBy === userId) return true;
  if (role === "super_admin" || role === "admin") {
    return doc.visibility !== "private";
  }
  return false;
}

export async function listMomWorkspace(callerId: string, role: Role) {
  const { existing } = await loadPortalStateAndUsers();
  const allDocs = existing.momDocuments ?? [];
  const allAssets = existing.momBrandAssets ?? [];

  const visibleDocs = allDocs
    .filter((doc) => canUserReadMom(doc, callerId, role))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // Organization letterheads & stamps are reusable org-wide; signatures are visible to uploader + team
  const visibleAssets = allAssets
    .slice()
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  return {
    ok: true as const,
    documents: visibleDocs,
    brandAssets: visibleAssets,
  };
}

function normalizeAudioMimeType(rawMime: string, ext: string): string {
  const base = (rawMime || "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (base.startsWith("audio/")) return base;
  if (base === "video/webm") return "audio/webm";
  if (base === "video/mp4") return "audio/mp4";
  switch (ext) {
    case ".mp3":
      return "audio/mp3";
    case ".wav":
      return "audio/wav";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".ogg":
    case ".oga":
    case ".opus":
      return "audio/ogg";
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    default:
      return "audio/webm";
  }
}

function isAudioSource(mime: string, ext: string, sourceType: string): boolean {
  if (sourceType === "recording") return true;
  const base = (mime || "").split(";")[0]?.trim().toLowerCase() ?? "";
  return base.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext);
}

interface GeneratedMomPayload {
  title: string;
  detectedLanguage: string;
  meetingDate: string;
  participants: string[];
  summary: string;
  agendaItems: string[];
  discussionHtml: string;
  decisions: string[];
  actionItems: Array<{
    task: string;
    owner: string;
    deadline: string;
    status: "Open" | "In Progress" | "Completed";
  }>;
  verbatimTranscript: string;
}

const MOM_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "Clear, formal title of the meeting." },
    detectedLanguage: {
      type: Type.STRING,
      description: "Primary language(s) detected in the recording or source document.",
    },
    meetingDate: {
      type: Type.STRING,
      description: "Meeting date in YYYY-MM-DD format if mentioned, else today's date.",
    },
    participants: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of attendee names, speakers, or teams mentioned.",
    },
    summary: {
      type: Type.STRING,
      description: "Thorough executive summary capturing the core context and outcomes.",
    },
    agendaItems: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Structured list of topics / agenda items covered.",
    },
    discussionHtml: {
      type: Type.STRING,
      description:
        "Clean semantic HTML (using <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <table>) detailing every discussed point, figure, requirement, risk, and decision faithfully without omitting details.",
    },
    decisions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Concrete decisions and approvals finalized during the meeting.",
    },
    actionItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          task: { type: Type.STRING, description: "Specific follow-up action item." },
          owner: {
            type: Type.STRING,
            description: "Responsible person or team (or 'Unassigned').",
          },
          deadline: { type: Type.STRING, description: "Target due date or timeframe (or 'TBD')." },
          status: {
            type: Type.STRING,
            description: "One of: Open, In Progress, Completed",
          },
        },
        required: ["task", "owner", "deadline", "status"],
      },
    },
    verbatimTranscript: {
      type: Type.STRING,
      description: "Complete word-for-word transcript or extracted source text.",
    },
  },
  required: [
    "title",
    "detectedLanguage",
    "meetingDate",
    "participants",
    "summary",
    "agendaItems",
    "discussionHtml",
    "decisions",
    "actionItems",
  ],
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildComposedMomHtml(payload: GeneratedMomPayload): string {
  const parts: string[] = [];

  if (payload.summary?.trim()) {
    parts.push(`<h2>1. Executive Summary</h2><p>${escapeHtml(payload.summary.trim())}</p>`);
  }

  if (payload.agendaItems?.length) {
    parts.push(
      `<h2>2. Agenda Covered</h2><ul>${payload.agendaItems
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul>`,
    );
  }

  if (payload.discussionHtml?.trim()) {
    parts.push(`<h2>3. Detailed Discussion &amp; Key Points</h2>${payload.discussionHtml.trim()}`);
  }

  if (payload.decisions?.length) {
    parts.push(
      `<h2>4. Key Decisions &amp; Approvals</h2><ol>${payload.decisions
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ol>`,
    );
  }

  return sanitizeMomHtml(parts.join("\n"));
}

function extractReadableTextFromLegacyDoc(buffer: Buffer): string {
  // Best-effort UTF-8 / UTF-16LE printable sequence extraction for legacy .doc / .rtf files
  const utf8 = buffer
    .toString("utf8")
    .replace(/\{\\[^}]*\}/g, " ")
    .replace(/\\[a-z]+\d* ?/gi, " ")
    .replace(/[^\x20-\x7E\n\r\t\u00A0-\uFFFF]/g, " ")
    .replace(/\s{3,}/g, "\n")
    .trim();
  return utf8.slice(0, 120_000);
}

export async function generateMomFromSource(
  callerId: string,
  options: {
    file?: File;
    buffer?: Buffer;
    fileName?: string;
    mimeType?: string;
    sourceType: "recording" | "upload";
    languageHint?: string;
    titleOverride?: string;
  },
): Promise<{ ok: true; document: MomDocument }> {
  assertRateLimit(`mom-gen:${callerId}`, { limit: 15, windowMs: 60_000 });

  const { file, sourceType, languageHint, titleOverride } = options;
  let buffer: Buffer;
  let rawFileName: string;
  let rawMimeInput: string;

  if (options.buffer) {
    buffer = options.buffer;
    rawFileName =
      options.fileName ||
      (sourceType === "recording" ? "meeting-recording.webm" : "meeting-source");
    rawMimeInput = options.mimeType || "";
  } else if (file && typeof file.arrayBuffer === "function") {
    buffer = Buffer.from(await file.arrayBuffer());
    rawFileName =
      file.name || (sourceType === "recording" ? "meeting-recording.webm" : "meeting-source");
    rawMimeInput = file.type || "";
  } else {
    throw new Error("Please record audio or select a valid non-empty file.");
  }

  if (buffer.length <= 0) {
    throw new Error("Please record audio or select a valid non-empty file.");
  }
  if (buffer.length > MAX_MOM_SOURCE_BYTES) {
    throw new Error(
      "File exceeds the 25 MB upload limit. Please use a smaller file or shorter clip.",
    );
  }

  const ai = getGeminiClient();
  const safeFileName = path.basename(rawFileName);
  const ext = path.extname(safeFileName).toLowerCase();
  const rawMime = rawMimeInput.split(";")[0]?.trim().toLowerCase() ?? "";
  const todayIso = new Date().toISOString().slice(0, 10);
  const langInstruction =
    languageHint && languageHint !== "auto"
      ? `The speaker(s)/source primarily use ${languageHint}, though other languages or code-switching may appear.`
      : "Detect any language(s) automatically (including multilingual speech or code-switching such as Hinglish, Arabic-English, etc.).";

  let verbatimTranscript = "";
  let parsedMom: GeneratedMomPayload;

  const AUDIO_TRANSCRIBE_MODELS = [
    "gemini-3.5-transcribe",
    "gemini-4-hydrogen",
    "gemini-3.1-flash-lite",
  ];
  const MOM_STRUCTURING_MODELS = ["gemini-4-hydrogen", "gemini-3.1-flash-lite"];

  if (isAudioSource(rawMime, ext, sourceType)) {
    const audioMime = normalizeAudioMimeType(rawMime, ext);
    const base64Audio = buffer.toString("base64");

    // Step 1: Word-for-word multilingual transcription (gemini-3.5-transcribe on v1beta, falling back to multimodal audio models if 404)
    const transcriptResponse = await generateWithModelFallback(ai, AUDIO_TRANSCRIBE_MODELS, {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: audioMime,
              data: base64Audio,
            },
          },
          {
            text: `Transcribe every single spoken word accurately and verbatim. ${langInstruction} Preserve exact names, numbers, dates, technical terms, decisions, and speaker transitions if distinguishable. Do not summarize or omit any spoken sentences.`,
          },
        ],
      },
    });

    verbatimTranscript = (transcriptResponse.text ?? "").trim();
    if (!verbatimTranscript) {
      throw new Error(
        "No intelligible speech could be transcribed from the audio. Please verify your microphone or audio file and try again.",
      );
    }

    // Step 2: Structure the verbatim transcript into a polished, comprehensive MOM
    const momResponse = await generateWithModelFallback(ai, MOM_STRUCTURING_MODELS, {
      contents: `Create a thorough, formal Minutes of the Meeting (MOM) from the following exact verbatim transcript.\n\nToday's date: ${todayIso}\n${titleOverride ? `Preferred meeting title: ${titleOverride}\n` : ""}${langInstruction}\n\nVERBATIM TRANSCRIPT:\n"""\n${verbatimTranscript}\n"""`,
      config: {
        systemInstruction:
          "You are an executive corporate secretary drafting authoritative Minutes of the Meeting (MOM). Capture every single fact, number, name, date, commitment, and nuance from the transcript faithfully. Write the structured MOM cleanly in clear professional English (while keeping important original-language quotes or terms in parentheses where helpful, OR matching the meeting's primary script if entirely non-English). Populate discussionHtml with well-structured semantic HTML (<h3>, <p>, <ul>, <li>, <strong>) covering all discussed topics in detail.",
        responseMimeType: "application/json",
        responseSchema: MOM_RESPONSE_SCHEMA,
      },
    });

    parsedMom = parseJsonResponse<GeneratedMomPayload>(momResponse.text);
    parsedMom.verbatimTranscript = verbatimTranscript;
  } else if (
    rawMime === "application/pdf" ||
    ext === ".pdf" ||
    rawMime.startsWith("image/") ||
    ALLOWED_IMAGE_EXTENSIONS.has(ext)
  ) {
    const mimeType =
      rawMime === "application/pdf" || ext === ".pdf"
        ? "application/pdf"
        : rawMime || (ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg");

    const momResponse = await generateWithModelFallback(ai, MOM_STRUCTURING_MODELS, {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: buffer.toString("base64"),
            },
          },
          {
            text: `Analyze this uploaded meeting document/PDF/image thoroughly and generate structured, complete Minutes of the Meeting (MOM). Today's date: ${todayIso}. ${titleOverride ? `Preferred meeting title: ${titleOverride}. ` : ""}${langInstruction} Preserve every key detail, number, attendee, date, decision, and action item, and include the full extracted text in verbatimTranscript.`,
          },
        ],
      },
      config: {
        systemInstruction:
          "You are an executive corporate secretary converting uploaded meeting notes, PDFs, or scans into polished, complete Minutes of the Meeting (MOM). Preserve every important detail accurately regardless of language.",
        responseMimeType: "application/json",
        responseSchema: MOM_RESPONSE_SCHEMA,
      },
    });

    parsedMom = parseJsonResponse<GeneratedMomPayload>(momResponse.text);
    verbatimTranscript = (parsedMom.verbatimTranscript ?? "").trim();
  } else {
    // Word documents (.docx, .doc) and plain text / markdown / csv / rtf
    let extractedText = "";
    if (ext === ".docx" || rawMime.includes("wordprocessingml")) {
      const mammothMod = await import("mammoth");
      const mammothLib = mammothMod.default ?? mammothMod;
      const result = await mammothLib.extractRawText({ buffer });
      extractedText = (result.value ?? "").trim();
    } else if ([".txt", ".md", ".csv", ".json"].includes(ext) || rawMime.startsWith("text/")) {
      extractedText = buffer.toString("utf8").trim();
    } else {
      extractedText = extractReadableTextFromLegacyDoc(buffer);
    }

    if (!extractedText || extractedText.length < 5) {
      throw new Error(
        `Could not extract readable text from "${safeFileName}". Try uploading a PDF, DOCX, TXT, or audio file.`,
      );
    }

    verbatimTranscript = extractedText;
    const momResponse = await generateWithModelFallback(ai, MOM_STRUCTURING_MODELS, {
      contents: `Convert the following uploaded document text into structured, executive-ready Minutes of the Meeting (MOM).\n\nToday's date: ${todayIso}\nSource filename: ${safeFileName}\n${titleOverride ? `Preferred meeting title: ${titleOverride}\n` : ""}${langInstruction}\n\nSOURCE DOCUMENT TEXT:\n"""\n${extractedText.slice(0, 120_000)}\n"""`,
      config: {
        systemInstruction:
          "You are an executive corporate secretary converting meeting documents into thorough, editable Minutes of the Meeting (MOM). Capture every detail, attendee, metric, decision, and follow-up action accurately across any language.",
        responseMimeType: "application/json",
        responseSchema: MOM_RESPONSE_SCHEMA,
      },
    });

    parsedMom = parseJsonResponse<GeneratedMomPayload>(momResponse.text);
    parsedMom.verbatimTranscript = extractedText;
  }

  const { existing, publicUsers } = await loadPortalStateAndUsers();
  const defaultLetterhead =
    (existing.momBrandAssets ?? []).find((a) => a.kind === "letterhead" && a.isDefault) ??
    (existing.momBrandAssets ?? []).find((a) => a.kind === "letterhead") ??
    null;

  const normalizedActions: MomActionItem[] = (parsedMom.actionItems ?? []).map((item, idx) => ({
    id: `ai-${Date.now()}-${idx}`,
    task: (item.task || "").trim() || "Follow-up item",
    owner: (item.owner || "").trim() || "Unassigned",
    deadline: (item.deadline || "").trim() || "TBD",
    status: item.status === "Completed" || item.status === "In Progress" ? item.status : "Open",
  }));

  const now = new Date().toISOString();
  const doc: MomDocument = {
    id: `mom-${crypto.randomUUID().slice(0, 12)}`,
    title: (titleOverride?.trim() || parsedMom.title?.trim() || "Minutes of the Meeting").slice(
      0,
      240,
    ),
    meetingDate: /^\d{4}-\d{2}-\d{2}$/.test(parsedMom.meetingDate ?? "")
      ? parsedMom.meetingDate
      : todayIso,
    meetingTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    location: sourceType === "recording" ? "Recorded Session" : "Uploaded Source",
    department: "",
    sourceType,
    sourceFileName: safeFileName,
    detectedLanguage: parsedMom.detectedLanguage || "Auto-detected",
    participants: Array.isArray(parsedMom.participants)
      ? parsedMom.participants.filter((p) => typeof p === "string" && p.trim().length > 0)
      : [],
    contentHtml: buildComposedMomHtml(parsedMom),
    actionItems: normalizedActions,
    verbatimTranscript: verbatimTranscript || parsedMom.verbatimTranscript || "",
    letterheadEnabled: Boolean(defaultLetterhead),
    letterheadAssetId: defaultLetterhead?.id ?? null,
    letterheadMode: defaultLetterhead?.letterheadMode ?? "header",
    overlays: [],
    visibility: "private",
    sharedWithIds: [],
    createdBy: callerId,
    createdAt: now,
    updatedAt: now,
  };

  const auditEntry: AuditLog = {
    id: crypto.randomUUID().slice(0, 12),
    actorId: callerId,
    action: "MOM created",
    detail: `Created MOM "${doc.title}" from ${sourceType} (${safeFileName})`,
    at: now,
  };

  const nextState: AppState = {
    ...existing,
    users: stripCredentialsFromUsers(publicUsers),
    momDocuments: [doc, ...(existing.momDocuments ?? [])],
    audit: [auditEntry, ...(existing.audit ?? [])].slice(0, 5000),
    sessionUserId: null,
  };
  await persistPortalState(nextState);

  return { ok: true, document: doc };
}

export async function saveMomDocumentRecord(
  callerId: string,
  role: Role,
  rawInput: unknown,
): Promise<{ ok: true; document: MomDocument }> {
  assertRateLimit(`mom-save:${callerId}`, { limit: 120, windowMs: 60_000 });
  const parsed = SaveMomDocumentSchema.parse(rawInput);

  const { existing, publicUsers } = await loadPortalStateAndUsers();
  const docs = existing.momDocuments ?? [];
  const existingDoc = parsed.id ? docs.find((d) => d.id === parsed.id) : undefined;

  if (existingDoc && !canUserModifyMom(existingDoc, callerId, role)) {
    throw new Error("Forbidden: Only the creator or an admin can edit this MOM.");
  }

  const now = new Date().toISOString();
  const cleanHtml = sanitizeMomHtml(parsed.contentHtml);
  const resolvedSourceFileName = parsed.sourceFileName ?? existingDoc?.sourceFileName;
  const resolvedDetectedLanguage = parsed.detectedLanguage ?? existingDoc?.detectedLanguage;
  const nextDoc: MomDocument = {
    id: existingDoc?.id ?? parsed.id ?? `mom-${crypto.randomUUID().slice(0, 12)}`,
    title: parsed.title,
    meetingDate: parsed.meetingDate,
    meetingTime: parsed.meetingTime ?? existingDoc?.meetingTime ?? "",
    location: parsed.location ?? existingDoc?.location ?? "",
    department: parsed.department ?? existingDoc?.department ?? "",
    sourceType: parsed.sourceType ?? existingDoc?.sourceType ?? "manual",
    ...(resolvedSourceFileName !== undefined ? { sourceFileName: resolvedSourceFileName } : {}),
    ...(resolvedDetectedLanguage !== undefined
      ? { detectedLanguage: resolvedDetectedLanguage }
      : {}),
    participants: parsed.participants,
    contentHtml: cleanHtml,
    actionItems: parsed.actionItems,
    verbatimTranscript: parsed.verbatimTranscript ?? existingDoc?.verbatimTranscript ?? "",
    letterheadEnabled: parsed.letterheadEnabled,
    letterheadAssetId: parsed.letterheadAssetId,
    letterheadMode: parsed.letterheadMode ?? existingDoc?.letterheadMode ?? "header",
    overlays: parsed.overlays,
    visibility: parsed.visibility,
    sharedWithIds: Array.from(new Set(parsed.sharedWithIds)),
    createdBy: existingDoc?.createdBy ?? callerId,
    createdAt: existingDoc?.createdAt ?? now,
    updatedAt: now,
  };

  // Determine newly shared recipients to send live team notifications
  const prevRecipients = new Set<string>(
    existingDoc
      ? existingDoc.visibility === "team"
        ? publicUsers.map((u) => u.id)
        : existingDoc.sharedWithIds
      : [],
  );
  const nextRecipients =
    nextDoc.visibility === "team"
      ? publicUsers.filter((u) => u.active && u.id !== callerId).map((u) => u.id)
      : nextDoc.visibility === "selected"
        ? nextDoc.sharedWithIds.filter((id) => id !== callerId)
        : [];

  const callerName = publicUsers.find((u) => u.id === callerId)?.fullName ?? "A teammate";
  const newNotifs: AppNotification[] = [];
  for (const uid of nextRecipients) {
    if (!prevRecipients.has(uid)) {
      newNotifs.push({
        id: crypto.randomUUID().slice(0, 12),
        userId: uid,
        title: "MOM shared with you",
        body: `${callerName} shared Minutes of the Meeting: "${nextDoc.title}"`,
        at: now,
        read: false,
        href: "/mom",
      });
    }
  }

  const nextDocs = existingDoc
    ? docs.map((d) => (d.id === existingDoc.id ? nextDoc : d))
    : [nextDoc, ...docs];

  const nextState: AppState = {
    ...existing,
    users: stripCredentialsFromUsers(publicUsers),
    momDocuments: nextDocs,
    notifications: [...newNotifs, ...(existing.notifications ?? [])].slice(0, 10_000),
    sessionUserId: null,
  };
  await persistPortalState(nextState);

  return { ok: true, document: nextDoc };
}

export async function deleteMomDocumentRecord(
  callerId: string,
  role: Role,
  docId: string,
): Promise<{ ok: true }> {
  const { existing, publicUsers } = await loadPortalStateAndUsers();
  const docs = existing.momDocuments ?? [];
  const target = docs.find((d) => d.id === docId);
  if (!target) {
    throw new Error("MOM document not found.");
  }
  if (!canUserModifyMom(target, callerId, role)) {
    throw new Error("Forbidden: You do not have permission to delete this MOM.");
  }

  const nextState: AppState = {
    ...existing,
    users: stripCredentialsFromUsers(publicUsers),
    momDocuments: docs.filter((d) => d.id !== docId),
    sessionUserId: null,
  };
  await persistPortalState(nextState);
  return { ok: true };
}

export async function saveMomBrandAssetUpload(
  callerId: string,
  options: {
    file?: File;
    buffer?: Buffer;
    fileName?: string;
    mimeType?: string;
    kind: "letterhead" | "stamp" | "signature";
    name?: string;
    letterheadMode?: "header" | "fullpage";
  },
): Promise<{ ok: true; asset: MomBrandAsset }> {
  assertRateLimit(`mom-asset:${callerId}`, { limit: 30, windowMs: 60_000 });
  const { file, kind, name, letterheadMode } = options;

  let bytes: Buffer;
  let origName: string;
  let origMime: string;

  if (options.buffer) {
    bytes = options.buffer;
    origName = options.fileName || `${kind}.png`;
    origMime = options.mimeType || "image/png";
  } else if (file && typeof file.arrayBuffer === "function") {
    bytes = Buffer.from(await file.arrayBuffer());
    origName = file.name || `${kind}.png`;
    origMime = file.type || "image/png";
  } else {
    throw new Error("Please select a valid image file (PNG, JPG, or WEBP).");
  }

  if (bytes.length <= 0) {
    throw new Error("Please select a valid image file (PNG, JPG, or WEBP).");
  }
  if (bytes.length > MAX_MOM_ASSET_BYTES) {
    throw new Error("Asset image exceeds the 10 MB limit.");
  }

  const rawName = path.basename(origName).replace(/[\r\n\0]/g, "");
  const ext = path.extname(rawName).toLowerCase() || ".png";
  const mimeType = origMime.split(";")[0]?.trim().toLowerCase() || "image/png";

  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext) && !ALLOWED_IMAGE_MIMES.has(mimeType)) {
    throw new Error(
      "Only PNG, JPG, and WEBP image files are supported for letterheads, stamps, and signatures.",
    );
  }

  const id = crypto.randomUUID();
  await fs.mkdir(MOM_ASSETS_ROOT, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(MOM_ASSETS_ROOT, `${id}.bin`), bytes),
    fs.writeFile(
      path.join(MOM_ASSETS_ROOT, `${id}.json`),
      JSON.stringify({ id, mimeType, name: rawName }),
      "utf8",
    ),
  ]);

  const accessToken = createMediaAccessToken(id);
  const now = new Date().toISOString();
  const asset: MomBrandAsset = {
    id,
    kind,
    name: (name?.trim() || rawName.replace(/\.[^.]+$/, "") || `${kind} asset`).slice(0, 120),
    url: `/api/mom/assets/${id}?access=${encodeURIComponent(accessToken)}`,
    mimeType,
    uploadedBy: callerId,
    uploadedAt: now,
    ...(kind === "letterhead"
      ? { letterheadMode: letterheadMode ?? "header", isDefault: true }
      : {}),
  };

  const { existing, publicUsers } = await loadPortalStateAndUsers();
  const prevAssets = existing.momBrandAssets ?? [];
  const nextAssets =
    kind === "letterhead"
      ? [
          asset,
          ...prevAssets.map((a) => (a.kind === "letterhead" ? { ...a, isDefault: false } : a)),
        ]
      : [asset, ...prevAssets];

  const nextState: AppState = {
    ...existing,
    users: stripCredentialsFromUsers(publicUsers),
    momBrandAssets: nextAssets,
    sessionUserId: null,
  };
  await persistPortalState(nextState);

  return { ok: true, asset };
}

export async function deleteMomBrandAssetRecord(
  callerId: string,
  role: Role,
  assetId: string,
): Promise<{ ok: true }> {
  const { existing, publicUsers } = await loadPortalStateAndUsers();
  const assets = existing.momBrandAssets ?? [];
  const target = assets.find((a) => a.id === assetId);
  if (!target) {
    throw new Error("Asset not found.");
  }
  if (target.uploadedBy !== callerId && role !== "super_admin" && role !== "admin") {
    throw new Error("Forbidden: Only the uploader or an admin can delete this asset.");
  }

  const nextState: AppState = {
    ...existing,
    users: stripCredentialsFromUsers(publicUsers),
    momBrandAssets: assets.filter((a) => a.id !== assetId),
    sessionUserId: null,
  };
  await persistPortalState(nextState);

  await Promise.allSettled([
    fs.unlink(path.join(MOM_ASSETS_ROOT, `${assetId}.bin`)),
    fs.unlink(path.join(MOM_ASSETS_ROOT, `${assetId}.json`)),
  ]);

  return { ok: true };
}

export async function readMomBrandAssetFile(
  assetId: string,
  options: { isAuthenticatedUser: boolean; accessToken?: string | null },
): Promise<Response> {
  if (!/^[a-f0-9-]{36}$/i.test(assetId)) {
    return new Response("Invalid asset identifier.", { status: 400 });
  }

  const tokenOk = options.accessToken
    ? verifyMediaAccessToken(assetId, options.accessToken)
    : false;
  if (!options.isAuthenticatedUser && !tokenOk) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const [rawMeta, bytes] = await Promise.all([
      fs.readFile(path.join(MOM_ASSETS_ROOT, `${assetId}.json`), "utf8"),
      fs.readFile(path.join(MOM_ASSETS_ROOT, `${assetId}.bin`)),
    ]);
    const meta = JSON.parse(rawMeta) as { mimeType?: string; name?: string };
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": meta.mimeType || "image/png",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Asset not found.", { status: 404 });
  }
}
