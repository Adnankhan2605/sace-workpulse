import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { ensurePortalInitialized } from "./auth.server.ts";
import { assertRateLimit } from "./rate-limit.server.ts";
import {
  SaveSmtpConfigSchema,
  SaveTeamsConfigSchema,
  TestSmtpConfigSchema,
  TestTeamsConfigSchema,
  type PublicSmtpConfig,
  type SaveSmtpConfigInput,
  type SaveTeamsConfigInput,
  type SmtpEncryptionMode,
  type TestSmtpConfigInput,
  type TestTeamsConfigInput,
} from "./smtp.schemas.ts";

declare global {
  var _ephemeralSmtpKey: Buffer | undefined;
}

function getSmtpEncryptionKey(): Buffer {
  const configured =
    process.env["SMTP_ENCRYPTION_KEY"]?.trim() || process.env["AUTH_SESSION_SECRET"]?.trim();
  if (configured && configured.length >= 16) {
    return crypto.createHash("sha256").update(`sace-smtp-v1:${configured}`).digest();
  }
  if (!global._ephemeralSmtpKey) {
    console.warn(
      "[SACE SMTP] SMTP_ENCRYPTION_KEY is not configured — using ephemeral in-memory encryption key for SMTP credentials.",
    );
    global._ephemeralSmtpKey = crypto.randomBytes(32);
  }
  return global._ephemeralSmtpKey;
}

export function encryptSmtpPassword(plain: string): string {
  const key = getSmtpEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSmtpPassword(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Stored SMTP password format is invalid.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored SMTP password payload is incomplete.");
  }
  const key = getSmtpEncryptionKey();
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(dataB64, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function isDisallowedIpAddress(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/i, "").toLowerCase();
  if (net.isIPv4(clean)) {
    const octets = clean.split(".").map((n) => Number(n));
    const [a = 0, b = 0] = octets;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a >= 224) return true; // multicast & reserved
    return false;
  }
  if (net.isIPv6(clean)) {
    if (clean === "::" || clean === "::1") return true;
    if (clean.startsWith("fc") || clean.startsWith("fd")) return true; // ULA fc00::/7
    if (
      clean.startsWith("fe8") ||
      clean.startsWith("fe9") ||
      clean.startsWith("fea") ||
      clean.startsWith("feb")
    ) {
      return true; // link-local fe80::/10
    }
    if (clean.startsWith("ff")) return true; // multicast
    return false;
  }
  return true;
}

export async function assertSafeSmtpHost(rawHost: string): Promise<string> {
  const host = rawHost.trim().toLowerCase();
  if (!host || host.length > 255 || /[\s/@\\]/.test(host)) {
    throw new Error("Invalid SMTP hostname.");
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    throw new Error("Private, loopback, or internal hostnames are not permitted for SMTP.");
  }

  if (net.isIP(host)) {
    if (isDisallowedIpAddress(host)) {
      throw new Error("Private, loopback, or link-local IP addresses are not permitted for SMTP.");
    }
    return host;
  }

  let resolved: { address: string }[];
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve SMTP hostname "${host}". Check the server address.`);
  }

  if (!resolved || resolved.length === 0) {
    throw new Error(`SMTP hostname "${host}" did not resolve to an address.`);
  }
  for (const entry of resolved) {
    if (isDisallowedIpAddress(entry.address)) {
      throw new Error(
        "SMTP hostname resolves to a restricted private or loopback network address.",
      );
    }
  }
  return host;
}

function toPublicSmtpConfig(row?: typeof schema.userSmtpConfigs.$inferSelect): PublicSmtpConfig {
  if (!row) {
    return {
      configured: false,
      providerLabel: "Custom SMTP",
      host: "",
      port: 587,
      encryption: "starttls",
      username: "",
      hasPassword: false,
      fromName: "",
      fromEmail: "",
      replyTo: "",
      enabled: true,
      lastVerifiedAt: null,
      lastTestStatus: null,
      lastTestError: null,
      hasTeamsWebhook: false,
      teamsEnabled: false,
      teamsLastVerifiedAt: null,
      teamsLastTestStatus: null,
      teamsLastTestError: null,
      updatedAt: null,
    };
  }
  const hasSmtp = Boolean(row.host && row.encryptedPassword);
  return {
    configured: hasSmtp,
    providerLabel: row.providerLabel || "Custom SMTP",
    host: row.host ?? "",
    port: row.port ?? 587,
    encryption: (row.encryption as SmtpEncryptionMode) || "starttls",
    username: row.username ?? "",
    hasPassword: Boolean(row.encryptedPassword),
    fromName: row.fromName ?? "",
    fromEmail: row.fromEmail ?? "",
    replyTo: row.replyTo ?? "",
    enabled: row.enabled,
    lastVerifiedAt: row.lastVerifiedAt ?? null,
    lastTestStatus:
      row.lastTestStatus === "verified" || row.lastTestStatus === "failed"
        ? row.lastTestStatus
        : null,
    lastTestError: row.lastTestError ?? null,
    hasTeamsWebhook: Boolean(row.teamsWebhookEncrypted),
    teamsEnabled: Boolean(row.teamsEnabled),
    teamsLastVerifiedAt: row.teamsLastVerifiedAt ?? null,
    teamsLastTestStatus:
      row.teamsLastTestStatus === "verified" || row.teamsLastTestStatus === "failed"
        ? row.teamsLastTestStatus
        : null,
    teamsLastTestError: row.teamsLastTestError ?? null,
    updatedAt: row.updatedAt,
  };
}

function buildTransporter(params: {
  host: string;
  port: number;
  encryption: SmtpEncryptionMode;
  username: string;
  password: string;
}) {
  return nodemailer.createTransport({
    host: params.host,
    port: params.port,
    secure: params.encryption === "ssl_tls",
    ...(params.encryption === "starttls" ? { requireTLS: true } : {}),
    ...(params.encryption === "none" ? { ignoreTLS: true } : {}),
    auth: {
      user: params.username,
      pass: params.password,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

export async function getMySmtpConfigRecord(userId: string): Promise<PublicSmtpConfig> {
  await ensurePortalInitialized();
  const rows = await db
    .select()
    .from(schema.userSmtpConfigs)
    .where(eq(schema.userSmtpConfigs.userId, userId))
    .limit(1);
  return toPublicSmtpConfig(rows[0]);
}

function normalizeSmtpPassword(host: string, rawPassword: string): string {
  const trimmed = rawPassword.trim();
  if (host.toLowerCase() === "smtp.gmail.com" && /^[a-z]{4}(?:\s+[a-z]{4}){3}$/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, "");
  }
  return trimmed;
}

function formatSmtpFailureMessage(err: unknown, host: string): string {
  const rawMsg = err instanceof Error ? err.message : "SMTP connection failed.";
  const lower = rawMsg.toLowerCase();
  if (
    host.toLowerCase() === "smtp.gmail.com" &&
    (lower.includes("535") ||
      lower.includes("badcredentials") ||
      lower.includes("username and password not accepted"))
  ) {
    return "Gmail rejected the username or App Password (535). Make sure 2-Step Verification is enabled and use a 16-character Google App Password (not your regular Gmail password).";
  }
  if (lower.includes("etimedout") || lower.includes("timeout")) {
    return `Connection to ${host} timed out. Check the host, port, and encryption mode (587 + STARTTLS or 465 + SSL/TLS).`;
  }
  return rawMsg.slice(0, 300);
}

export async function saveMySmtpConfigRecord(
  userId: string,
  rawInput: SaveSmtpConfigInput | unknown,
): Promise<{ ok: true; config: PublicSmtpConfig }> {
  assertRateLimit(`smtp-save:${userId}`, { limit: 25, windowMs: 60_000 });
  const data = SaveSmtpConfigSchema.parse(rawInput);
  await ensurePortalInitialized();

  const safeHost = await assertSafeSmtpHost(data.host);
  const existingRows = await db
    .select()
    .from(schema.userSmtpConfigs)
    .where(eq(schema.userSmtpConfigs.userId, userId))
    .limit(1);
  const existing = existingRows[0];

  const incomingPassword = normalizeSmtpPassword(safeHost, data.password ?? "");
  let encryptedPassword: string;
  if (incomingPassword) {
    encryptedPassword = encryptSmtpPassword(incomingPassword);
  } else if (existing?.encryptedPassword) {
    encryptedPassword = existing.encryptedPassword;
  } else {
    throw new Error("SMTP password is required when configuring a new mail integration.");
  }

  const now = new Date().toISOString();
  const record = {
    userId,
    providerLabel: data.providerLabel.trim() || "Custom SMTP",
    host: safeHost,
    port: data.port,
    encryption: data.encryption,
    username: data.username.trim(),
    encryptedPassword,
    fromName: data.fromName.trim(),
    fromEmail: data.fromEmail.trim().toLowerCase(),
    replyTo: data.replyTo?.trim() ? data.replyTo.trim().toLowerCase() : null,
    enabled: data.enabled,
    lastVerifiedAt:
      existing &&
      existing.host === safeHost &&
      existing.port === data.port &&
      existing.username === data.username.trim() &&
      !incomingPassword
        ? existing.lastVerifiedAt
        : null,
    lastTestStatus:
      existing &&
      existing.host === safeHost &&
      existing.port === data.port &&
      existing.username === data.username.trim() &&
      !incomingPassword
        ? existing.lastTestStatus
        : null,
    lastTestError: null,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(schema.userSmtpConfigs)
      .set(record)
      .where(eq(schema.userSmtpConfigs.userId, userId));
  } else {
    await db.insert(schema.userSmtpConfigs).values(record);
  }

  const savedRows = await db
    .select()
    .from(schema.userSmtpConfigs)
    .where(eq(schema.userSmtpConfigs.userId, userId))
    .limit(1);

  return {
    ok: true as const,
    config: toPublicSmtpConfig(savedRows[0]),
  };
}

export async function testMySmtpConfigRecord(
  userId: string,
  rawInput: TestSmtpConfigInput | unknown,
): Promise<{ ok: boolean; message: string; config?: PublicSmtpConfig }> {
  let transporter: ReturnType<typeof buildTransporter> | undefined;
  let existing: typeof schema.userSmtpConfigs.$inferSelect | undefined;
  let hostForMessage = "";
  const now = new Date().toISOString();

  try {
    assertRateLimit(`smtp-test:${userId}`, { limit: 15, windowMs: 5 * 60_000 });
    const data = TestSmtpConfigSchema.parse(rawInput);
    hostForMessage = data.host;
    await ensurePortalInitialized();

    const safeHost = await assertSafeSmtpHost(data.host);
    hostForMessage = safeHost;

    const existingRows = await db
      .select()
      .from(schema.userSmtpConfigs)
      .where(eq(schema.userSmtpConfigs.userId, userId))
      .limit(1);
    existing = existingRows[0];

    const incomingPassword = normalizeSmtpPassword(safeHost, data.password ?? "");
    let plainPassword: string;
    if (incomingPassword) {
      plainPassword = incomingPassword;
    } else if (existing?.encryptedPassword) {
      try {
        plainPassword = decryptSmtpPassword(existing.encryptedPassword);
      } catch {
        throw new Error(
          "Your saved SMTP password could not be decrypted after a server restart. Please re-enter your SMTP password or App Password and save again.",
        );
      }
    } else {
      throw new Error("Enter your SMTP password or App Password before testing the connection.");
    }

    transporter = buildTransporter({
      host: safeHost,
      port: data.port,
      encryption: data.encryption,
      username: data.username.trim(),
      password: plainPassword,
    });

    await transporter.verify();

    let message = `SMTP connection verified with ${safeHost}:${data.port}.`;
    if (data.mode === "send_test") {
      const recipient = data.testRecipient?.trim() || data.fromEmail.trim();
      await transporter.sendMail({
        from: `"${data.fromName.trim().replace(/"/g, "")}" <${data.fromEmail.trim()}>`,
        to: recipient,
        ...(data.replyTo?.trim() ? { replyTo: data.replyTo.trim() } : {}),
        subject: "SACE Workpulse — SMTP Mail Integration Test",
        text: `Your personal SMTP integration (${safeHost}:${data.port}) is working properly.\n\nSent at ${now}.`,
      });
      message = `Test email sent successfully to ${recipient}.`;
    }

    if (existing) {
      await db
        .update(schema.userSmtpConfigs)
        .set({
          lastVerifiedAt: now,
          lastTestStatus: "verified",
          lastTestError: null,
          updatedAt: now,
        })
        .where(eq(schema.userSmtpConfigs.userId, userId));
    }

    const updatedRows = await db
      .select()
      .from(schema.userSmtpConfigs)
      .where(eq(schema.userSmtpConfigs.userId, userId))
      .limit(1);

    return {
      ok: true,
      message,
      ...(updatedRows[0] ? { config: toPublicSmtpConfig(updatedRows[0]) } : {}),
    };
  } catch (err) {
    const cleanErr = formatSmtpFailureMessage(err, hostForMessage || "SMTP server");

    if (existing) {
      try {
        await db
          .update(schema.userSmtpConfigs)
          .set({
            lastTestStatus: "failed",
            lastTestError: cleanErr,
            updatedAt: now,
          })
          .where(eq(schema.userSmtpConfigs.userId, userId));
      } catch {
        // Ignore secondary persistence error when returning failure details
      }
    }

    let latestConfig: PublicSmtpConfig | undefined;
    if (existing) {
      try {
        const updatedRows = await db
          .select()
          .from(schema.userSmtpConfigs)
          .where(eq(schema.userSmtpConfigs.userId, userId))
          .limit(1);
        if (updatedRows[0]) {
          latestConfig = toPublicSmtpConfig(updatedRows[0]);
        }
      } catch {
        // Ignore secondary read error
      }
    }

    return {
      ok: false,
      message: cleanErr,
      ...(latestConfig ? { config: latestConfig } : {}),
    };
  } finally {
    transporter?.close();
  }
}

export async function deleteMySmtpConfigRecord(
  userId: string,
): Promise<{ ok: true; config: PublicSmtpConfig }> {
  await ensurePortalInitialized();
  const rows = await db
    .select()
    .from(schema.userSmtpConfigs)
    .where(eq(schema.userSmtpConfigs.userId, userId))
    .limit(1);
  const existing = rows[0];
  if (!existing) {
    return { ok: true as const, config: toPublicSmtpConfig(undefined) };
  }

  if (existing.teamsWebhookEncrypted) {
    const now = new Date().toISOString();
    await db
      .update(schema.userSmtpConfigs)
      .set({
        providerLabel: "Custom SMTP",
        host: "",
        port: 587,
        encryption: "starttls",
        username: "",
        encryptedPassword: "",
        fromName: "",
        fromEmail: "",
        replyTo: null,
        enabled: true,
        lastVerifiedAt: null,
        lastTestStatus: null,
        lastTestError: null,
        updatedAt: now,
      })
      .where(eq(schema.userSmtpConfigs.userId, userId));
    const updated = await db
      .select()
      .from(schema.userSmtpConfigs)
      .where(eq(schema.userSmtpConfigs.userId, userId))
      .limit(1);
    return { ok: true as const, config: toPublicSmtpConfig(updated[0]) };
  }

  await db.delete(schema.userSmtpConfigs).where(eq(schema.userSmtpConfigs.userId, userId));
  return {
    ok: true as const,
    config: toPublicSmtpConfig(undefined),
  };
}

export async function assertSafeTeamsWebhookUrl(rawUrl: string): Promise<string> {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid HTTPS Microsoft Teams webhook URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Microsoft Teams webhook URL must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Webhook URL must not contain embedded credentials.");
  }
  await assertSafeSmtpHost(parsed.hostname);
  return parsed.toString();
}

export async function postToTeamsWebhookUrl(
  webhookUrl: string,
  payload: { title: string; summary?: string; text: string },
): Promise<void> {
  const safeUrl = await assertSafeTeamsWebhookUrl(webhookUrl);
  const res = await fetch(safeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      themeColor: "520380",
      summary: payload.summary ?? payload.title,
      title: payload.title,
      text: payload.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Teams webhook returned HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
}

export async function saveMyTeamsConfigRecord(
  userId: string,
  rawInput: SaveTeamsConfigInput | unknown,
): Promise<{ ok: true; config: PublicSmtpConfig }> {
  assertRateLimit(`teams-save:${userId}`, { limit: 25, windowMs: 60_000 });
  const data = SaveTeamsConfigSchema.parse(rawInput);
  await ensurePortalInitialized();

  const existingRows = await db
    .select()
    .from(schema.userSmtpConfigs)
    .where(eq(schema.userSmtpConfigs.userId, userId))
    .limit(1);
  const existing = existingRows[0];

  const incomingUrl = (data.webhookUrl ?? "").trim();
  let teamsWebhookEncrypted: string | null = existing?.teamsWebhookEncrypted ?? null;
  let changedUrl = false;
  if (incomingUrl) {
    const safeUrl = await assertSafeTeamsWebhookUrl(incomingUrl);
    teamsWebhookEncrypted = encryptSmtpPassword(safeUrl);
    changedUrl = true;
  } else if (!teamsWebhookEncrypted) {
    throw new Error("Enter your Microsoft Teams webhook URL before saving.");
  }

  const now = new Date().toISOString();
  if (existing) {
    await db
      .update(schema.userSmtpConfigs)
      .set({
        teamsWebhookEncrypted,
        teamsEnabled: data.enabled,
        ...(changedUrl
          ? { teamsLastVerifiedAt: null, teamsLastTestStatus: null, teamsLastTestError: null }
          : {}),
        updatedAt: now,
      })
      .where(eq(schema.userSmtpConfigs.userId, userId));
  } else {
    await db.insert(schema.userSmtpConfigs).values({
      userId,
      providerLabel: "Microsoft Teams",
      host: "",
      port: 587,
      encryption: "starttls",
      username: "",
      encryptedPassword: "",
      fromName: "",
      fromEmail: "",
      replyTo: null,
      enabled: true,
      lastVerifiedAt: null,
      lastTestStatus: null,
      lastTestError: null,
      teamsWebhookEncrypted,
      teamsEnabled: data.enabled,
      teamsLastVerifiedAt: null,
      teamsLastTestStatus: null,
      teamsLastTestError: null,
      updatedAt: now,
    });
  }

  const savedRows = await db
    .select()
    .from(schema.userSmtpConfigs)
    .where(eq(schema.userSmtpConfigs.userId, userId))
    .limit(1);
  return { ok: true as const, config: toPublicSmtpConfig(savedRows[0]) };
}

export async function testMyTeamsConfigRecord(
  userId: string,
  rawInput: TestTeamsConfigInput | unknown,
): Promise<{ ok: boolean; message: string; config?: PublicSmtpConfig }> {
  const now = new Date().toISOString();
  let existing: typeof schema.userSmtpConfigs.$inferSelect | undefined;
  try {
    assertRateLimit(`teams-test:${userId}`, { limit: 15, windowMs: 5 * 60_000 });
    const data = TestTeamsConfigSchema.parse(rawInput);
    await ensurePortalInitialized();

    const existingRows = await db
      .select()
      .from(schema.userSmtpConfigs)
      .where(eq(schema.userSmtpConfigs.userId, userId))
      .limit(1);
    existing = existingRows[0];

    const incomingUrl = (data.webhookUrl ?? "").trim();
    let targetUrl: string;
    if (incomingUrl) {
      targetUrl = await assertSafeTeamsWebhookUrl(incomingUrl);
    } else if (existing?.teamsWebhookEncrypted) {
      try {
        targetUrl = decryptSmtpPassword(existing.teamsWebhookEncrypted);
      } catch {
        throw new Error(
          "Your saved Teams webhook URL could not be decrypted after a server restart. Re-enter the webhook URL and save again.",
        );
      }
    } else {
      throw new Error("Enter your Microsoft Teams webhook URL before testing.");
    }

    await postToTeamsWebhookUrl(targetUrl, {
      title: "SACE Workpulse — Microsoft Teams Integration Test",
      summary: "Teams channel integration test",
      text: `Your Microsoft Teams webhook connection is working properly.\n\nSent at ${now}.`,
    });

    if (existing) {
      await db
        .update(schema.userSmtpConfigs)
        .set({
          teamsLastVerifiedAt: now,
          teamsLastTestStatus: "verified",
          teamsLastTestError: null,
          updatedAt: now,
        })
        .where(eq(schema.userSmtpConfigs.userId, userId));
    }
    const updatedRows = await db
      .select()
      .from(schema.userSmtpConfigs)
      .where(eq(schema.userSmtpConfigs.userId, userId))
      .limit(1);
    return {
      ok: true,
      message: "Test notification sent to Microsoft Teams.",
      ...(updatedRows[0] ? { config: toPublicSmtpConfig(updatedRows[0]) } : {}),
    };
  } catch (err) {
    const cleanErr =
      err instanceof Error ? err.message.slice(0, 300) : "Teams webhook test failed.";
    if (existing) {
      try {
        await db
          .update(schema.userSmtpConfigs)
          .set({
            teamsLastTestStatus: "failed",
            teamsLastTestError: cleanErr,
            updatedAt: now,
          })
          .where(eq(schema.userSmtpConfigs.userId, userId));
      } catch {
        // Ignore secondary persistence error
      }
    }
    let latestConfig: PublicSmtpConfig | undefined;
    if (existing) {
      try {
        const updatedRows = await db
          .select()
          .from(schema.userSmtpConfigs)
          .where(eq(schema.userSmtpConfigs.userId, userId))
          .limit(1);
        if (updatedRows[0]) latestConfig = toPublicSmtpConfig(updatedRows[0]);
      } catch {
        // Ignore secondary read error
      }
    }
    return {
      ok: false,
      message: cleanErr,
      ...(latestConfig ? { config: latestConfig } : {}),
    };
  }
}

export async function deleteMyTeamsConfigRecord(
  userId: string,
): Promise<{ ok: true; config: PublicSmtpConfig }> {
  await ensurePortalInitialized();
  const rows = await db
    .select()
    .from(schema.userSmtpConfigs)
    .where(eq(schema.userSmtpConfigs.userId, userId))
    .limit(1);
  const existing = rows[0];
  if (!existing) {
    return { ok: true as const, config: toPublicSmtpConfig(undefined) };
  }

  if (existing.host && existing.encryptedPassword) {
    const now = new Date().toISOString();
    await db
      .update(schema.userSmtpConfigs)
      .set({
        teamsWebhookEncrypted: null,
        teamsEnabled: false,
        teamsLastVerifiedAt: null,
        teamsLastTestStatus: null,
        teamsLastTestError: null,
        updatedAt: now,
      })
      .where(eq(schema.userSmtpConfigs.userId, userId));
    const updated = await db
      .select()
      .from(schema.userSmtpConfigs)
      .where(eq(schema.userSmtpConfigs.userId, userId))
      .limit(1);
    return { ok: true as const, config: toPublicSmtpConfig(updated[0]) };
  }

  await db.delete(schema.userSmtpConfigs).where(eq(schema.userSmtpConfigs.userId, userId));
  return { ok: true as const, config: toPublicSmtpConfig(undefined) };
}

export async function sendEmailViaUserSmtp(
  userId: string,
  payload: { to: string; subject: string; text: string; html?: string; replyTo?: string },
): Promise<{ ok: true; messageId: string }> {
  await ensurePortalInitialized();
  const rows = await db
    .select()
    .from(schema.userSmtpConfigs)
    .where(eq(schema.userSmtpConfigs.userId, userId))
    .limit(1);
  const cfg = rows[0];
  if (!cfg || !cfg.enabled || !cfg.host || !cfg.encryptedPassword) {
    throw new Error("Personal SMTP integration is not configured or is disabled.");
  }
  const safeHost = await assertSafeSmtpHost(cfg.host);
  const plainPassword = decryptSmtpPassword(cfg.encryptedPassword);
  const transporter = buildTransporter({
    host: safeHost,
    port: cfg.port,
    encryption: (cfg.encryption as SmtpEncryptionMode) || "starttls",
    username: cfg.username,
    password: plainPassword,
  });

  try {
    const info = await transporter.sendMail({
      from: `"${cfg.fromName.replace(/"/g, "")}" <${cfg.fromEmail}>`,
      to: payload.to,
      ...(payload.replyTo || cfg.replyTo
        ? { replyTo: payload.replyTo || cfg.replyTo || undefined }
        : {}),
      subject: payload.subject,
      text: payload.text,
      ...(payload.html ? { html: payload.html } : {}),
    });
    return { ok: true as const, messageId: info.messageId };
  } finally {
    transporter.close();
  }
}

export async function sendPortalMailAndTeamsAlert(options: {
  preferredSenderUserId?: string;
  toEmails?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  teamsTitle?: string;
  teamsText?: string;
  notifySuperAdminTeams?: boolean;
}): Promise<{ emailSent: boolean; teamsSent: boolean }> {
  await ensurePortalInitialized();
  const [smtpRows, userRows] = await Promise.all([
    db.select().from(schema.userSmtpConfigs),
    db.select().from(schema.users),
  ]);

  const userRoleById = new Map(userRows.map((u) => [u.id, u.role]));
  const activeSmtpConfigs = smtpRows.filter(
    (c) => c.enabled && Boolean(c.host) && Boolean(c.encryptedPassword),
  );

  let senderCfg: typeof schema.userSmtpConfigs.$inferSelect | undefined;
  if (options.preferredSenderUserId) {
    senderCfg = activeSmtpConfigs.find((c) => c.userId === options.preferredSenderUserId);
  }
  if (!senderCfg) {
    senderCfg = activeSmtpConfigs.find((c) => userRoleById.get(c.userId) === "super_admin");
  }
  if (!senderCfg) {
    senderCfg = activeSmtpConfigs.find((c) => userRoleById.get(c.userId) === "admin");
  }
  if (!senderCfg) {
    senderCfg = activeSmtpConfigs[0];
  }

  let emailSent = false;
  const recipients = Array.from(
    new Set(
      (options.toEmails ?? []).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")),
    ),
  );

  if (senderCfg && recipients.length > 0) {
    let transporter: ReturnType<typeof buildTransporter> | undefined;
    try {
      const safeHost = await assertSafeSmtpHost(senderCfg.host);
      const plainPassword = decryptSmtpPassword(senderCfg.encryptedPassword);
      transporter = buildTransporter({
        host: safeHost,
        port: senderCfg.port,
        encryption: (senderCfg.encryption as SmtpEncryptionMode) || "starttls",
        username: senderCfg.username,
        password: plainPassword,
      });
      await transporter.sendMail({
        from: `"${senderCfg.fromName.replace(/"/g, "")}" <${senderCfg.fromEmail}>`,
        to: recipients.join(", "),
        ...(options.replyTo || senderCfg.replyTo
          ? { replyTo: options.replyTo || senderCfg.replyTo || undefined }
          : {}),
        subject: options.subject,
        text: options.text,
        ...(options.html ? { html: options.html } : {}),
      });
      emailSent = true;
    } catch (err) {
      console.error("[SACE Mail Alert] Failed to send email alert:", err);
    } finally {
      transporter?.close();
    }
  }

  let teamsSent = false;
  if (options.notifySuperAdminTeams !== false) {
    const teamsTargets = smtpRows.filter(
      (c) =>
        c.teamsEnabled &&
        Boolean(c.teamsWebhookEncrypted) &&
        (userRoleById.get(c.userId) === "super_admin" || userRoleById.get(c.userId) === "admin"),
    );
    for (const target of teamsTargets) {
      if (!target.teamsWebhookEncrypted) continue;
      try {
        const webhookUrl = decryptSmtpPassword(target.teamsWebhookEncrypted);
        await postToTeamsWebhookUrl(webhookUrl, {
          title: options.teamsTitle ?? options.subject,
          summary: options.subject,
          text: options.teamsText ?? options.text,
        });
        teamsSent = true;
      } catch (err) {
        console.error("[SACE Teams Alert] Failed to send Teams notification:", err);
      }
    }
  }

  return { emailSent, teamsSent };
}
