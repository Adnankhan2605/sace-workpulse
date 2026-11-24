import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createMediaAccessToken, verifyMediaAccessToken } from "./auth.server.ts";
import { assertRateLimit } from "./rate-limit.server.ts";
import type { MessageAttachment, MessageAttachmentKind } from "./types.ts";

export const MAX_MESSAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const UPLOAD_ROOT = path.resolve(process.cwd(), ".sace-uploads", "messages");

const BLOCKED_EXTENSIONS = new Set([
  ".svg",
  ".svgz",
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".sh",
  ".ps1",
  ".msi",
  ".scr",
  ".vbs",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".html",
  ".htm",
  ".xhtml",
  ".php",
  ".py",
  ".rb",
  ".pl",
  ".jar",
  ".app",
  ".dmg",
  ".iso",
  ".lnk",
]);

const BLOCKED_MIMES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "application/javascript",
  "text/javascript",
  "application/x-msdownload",
  "application/x-dosexec",
  "application/x-sh",
  "application/x-httpd-php",
]);

interface StoredFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: MessageAttachmentKind;
  ext: string;
  uploadedBy: string;
  uploadedAt: string;
}

function classifyAttachment(mimeType: string, ext: string): MessageAttachmentKind {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"].includes(ext)) {
    return "image";
  }
  if (m.startsWith("video/") || [".mp4", ".webm", ".mov", ".m4v", ".mkv"].includes(ext)) {
    return "video";
  }
  if (m.startsWith("audio/") || [".mp3", ".wav", ".ogg", ".m4a", ".aac"].includes(ext)) {
    return "audio";
  }
  if (m === "application/pdf" || ext === ".pdf") {
    return "pdf";
  }
  if (
    [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".rtf", ".odt"].includes(
      ext,
    ) ||
    m.includes("word") ||
    m.includes("document") ||
    m.includes("spreadsheet") ||
    m.includes("presentation") ||
    m.startsWith("text/")
  ) {
    return "document";
  }
  return "other";
}

function sanitizeDisplayFileName(rawName: string): string {
  const base = path.basename(rawName || "attachment").replace(/[\r\n\0]/g, "");
  return base.slice(0, 180) || "attachment";
}

export async function saveMessageUpload(callerId: string, file: File): Promise<MessageAttachment> {
  assertRateLimit(`msg-upload:${callerId}`, { limit: 30, windowMs: 60_000 });

  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Please select a valid file to upload.");
  }

  if (file.size <= 0) {
    throw new Error("The selected file is empty.");
  }

  if (file.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
    throw new Error("File is too large. Maximum allowed attachment size is 10 MB.");
  }

  const safeName = sanitizeDisplayFileName(file.name);
  const ext = path.extname(safeName).toLowerCase();
  const mimeType = (file.type || "application/octet-stream").toLowerCase();

  if (BLOCKED_EXTENSIONS.has(ext) || BLOCKED_MIMES.has(mimeType)) {
    throw new Error(
      `Unsupported or unsafe file type (${ext || mimeType}). Executable, script, HTML, and SVG files are blocked.`,
    );
  }

  const id = crypto.randomUUID();
  const kind = classifyAttachment(mimeType, ext);
  const bytes = Buffer.from(await file.arrayBuffer());

  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  const binPath = path.join(UPLOAD_ROOT, `${id}.bin`);
  const metaPath = path.join(UPLOAD_ROOT, `${id}.json`);

  const meta: StoredFileMeta = {
    id,
    name: safeName,
    mimeType,
    size: bytes.length,
    kind,
    ext: ext.replace(/^\./, "").toUpperCase(),
    uploadedBy: callerId,
    uploadedAt: new Date().toISOString(),
  };

  await Promise.all([
    fs.writeFile(binPath, bytes),
    fs.writeFile(metaPath, JSON.stringify(meta), "utf8"),
  ]);

  const accessToken = createMediaAccessToken(id);
  return {
    id,
    name: meta.name,
    mimeType: meta.mimeType,
    size: meta.size,
    url: `/api/messages/files/${id}?access=${encodeURIComponent(accessToken)}`,
    kind: meta.kind,
    ext: meta.ext,
  };
}

export async function readMessageUpload(
  fileId: string,
  options: { isAuthenticatedUser: boolean; accessToken?: string | null; forceDownload?: boolean },
): Promise<Response> {
  if (!/^[a-f0-9-]{36}$/i.test(fileId)) {
    return new Response("Invalid file identifier.", { status: 400 });
  }

  const tokenOk = options.accessToken ? verifyMediaAccessToken(fileId, options.accessToken) : false;
  if (!options.isAuthenticatedUser && !tokenOk) {
    return new Response("Unauthorized", { status: 401 });
  }

  const binPath = path.join(UPLOAD_ROOT, `${fileId}.bin`);
  const metaPath = path.join(UPLOAD_ROOT, `${fileId}.json`);

  try {
    const [rawMeta, bytes] = await Promise.all([
      fs.readFile(metaPath, "utf8"),
      fs.readFile(binPath),
    ]);
    const meta = JSON.parse(rawMeta) as StoredFileMeta;
    const inlineAllowed =
      !options.forceDownload &&
      (meta.kind === "image" ||
        meta.kind === "video" ||
        meta.kind === "audio" ||
        meta.kind === "pdf");
    const disposition = inlineAllowed ? "inline" : "attachment";
    const safeDownloadName = meta.name.replace(/"/g, "");

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": meta.mimeType || "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${disposition}; filename="${safeDownloadName}"`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Attachment not found.", { status: 404 });
  }
}
