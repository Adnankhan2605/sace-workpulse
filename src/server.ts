import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

if (typeof process !== "undefined" && process.env["TSS_PRERENDERING"] !== "true") {
  void import("./lib/auth.server.ts")
    .then((m) => m.ensurePortalInitialized())
    .catch((err) => {
      console.error("[SACE Startup] Portal initialization failed:", err);
    });
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

function isJsonOrRpcRequest(request: Request): boolean {
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/") || pathname.startsWith("/_serverFn")) {
      return true;
    }
  } catch {
    // Ignore URL parse error
  }
  if (request.headers.get("x-tsr-serverfn") === "true") {
    return true;
  }
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const captured = consumeLastCapturedError();
  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  if (isJsonOrRpcRequest(request)) {
    const message =
      captured instanceof Error ? captured.message : "Server request failed. Please try again.";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=(self)");
  if (process.env["NODE_ENV"] === "production") {
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  if (!headers.has("Content-Security-Policy")) {
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: data:",
        "connect-src 'self' https://*.supabase.co https://generativelanguage.googleapis.com",
        "object-src 'none'",
        "base-uri 'self'",
      ].join("; "),
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleBattalionApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/api/presence" && path !== "/api/battalions") {
    return null;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  const { resolveAuthenticatedUserFromRequest } = await import("./lib/auth.server.ts");
  const auth = await resolveAuthenticatedUserFromRequest(request);
  if (!auth) {
    return json({ ok: false, error: "Unauthorized: Please sign in to continue." }, 401);
  }

  try {
    if (path === "/api/presence" && (request.method === "PUT" || request.method === "POST")) {
      const { saveUserPresenceRecord } = await import("./lib/battalion.server.ts");
      const payload = await request.json();
      const result = await saveUserPresenceRecord(auth.userId, payload);
      return json(result, 200);
    }

    if (path === "/api/battalions" && request.method === "GET") {
      const { fetchPopulatedBattalions } = await import("./lib/battalion.server.ts");
      const result = await fetchPopulatedBattalions(auth.userId);
      return json(result, 200);
    }

    if (path === "/api/battalions" && request.method === "POST") {
      if (auth.role !== "admin" && auth.role !== "super_admin") {
        return json({ ok: false, error: "Forbidden: Admin or Super Admin role required." }, 403);
      }
      const { createBattalionRecord } = await import("./lib/battalion.server.ts");
      const payload = await request.json();
      const result = await createBattalionRecord(auth.userId, auth.role, payload);
      return json(result, 201);
    }

    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed.";
    const status = message.startsWith("Forbidden:") ? 403 : 400;
    return json({ ok: false, error: message }, status);
  }
}

async function handleMessagesUploadApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/messages/upload") {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    const { resolveAuthenticatedUserFromRequest } = await import("./lib/auth.server.ts");
    const auth = await resolveAuthenticatedUserFromRequest(request);
    if (!auth) {
      return json({ ok: false, error: "Unauthorized: Please sign in to upload files." }, 401);
    }

    try {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return json({ ok: false, error: "No file found in upload request." }, 400);
      }
      const { saveMessageUpload } = await import("./lib/messages-upload.server.ts");
      const attachment = await saveMessageUpload(auth.userId, file);
      return json({ ok: true, attachment }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload file.";
      return json({ ok: false, error: message }, 400);
    }
  }

  if (path.startsWith("/api/messages/files/") && request.method === "GET") {
    const fileId = path.slice("/api/messages/files/".length);
    const { resolveAuthenticatedUserFromRequest } = await import("./lib/auth.server.ts");
    const auth = await resolveAuthenticatedUserFromRequest(request);
    const { readMessageUpload } = await import("./lib/messages-upload.server.ts");
    return readMessageUpload(fileId, {
      isAuthenticatedUser: Boolean(auth),
      accessToken: url.searchParams.get("access"),
      forceDownload: url.searchParams.get("download") === "1",
    });
  }

  return null;
}

async function handleMomApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/mom")) {
    return null;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  try {
    // Serve stored letterhead / stamp / signature image via session OR signed HMAC token
    if (path.startsWith("/api/mom/assets/") && request.method === "GET") {
      const assetId = path.slice("/api/mom/assets/".length);
      const { resolveAuthenticatedUserFromRequest } = await import("./lib/auth.server.ts");
      const auth = await resolveAuthenticatedUserFromRequest(request);
      const { readMomBrandAssetFile } = await import("./lib/mom.server.ts");
      return readMomBrandAssetFile(assetId, {
        isAuthenticatedUser: Boolean(auth),
        accessToken: url.searchParams.get("access"),
      });
    }

    const { resolveAuthenticatedUserFromRequest } = await import("./lib/auth.server.ts");
    const auth = await resolveAuthenticatedUserFromRequest(request);
    if (!auth) {
      return json({ ok: false, error: "Unauthorized: Please sign in to access MOM." }, 401);
    }

    if (path === "/api/mom/workspace" && request.method === "GET") {
      const { listMomWorkspace } = await import("./lib/mom.server.ts");
      const data = await listMomWorkspace(auth.userId, auth.role);
      return json(data, 200);
    }

    if (path === "/api/mom/generate" && request.method === "POST") {
      const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
      const { generateMomFromSource } = await import("./lib/mom.server.ts");

      if (contentType.includes("application/json")) {
        const body = (await request.json()) as {
          base64Data?: string;
          fileName?: string;
          mimeType?: string;
          sourceType?: string;
          languageHint?: string;
          title?: string;
        };
        if (!body.base64Data || typeof body.base64Data !== "string") {
          return json({ ok: false, error: "No audio or document file data provided." }, 400);
        }
        const rawB64 = body.base64Data.includes(",")
          ? body.base64Data.slice(body.base64Data.indexOf(",") + 1)
          : body.base64Data;
        const buffer = Buffer.from(rawB64, "base64");
        const sourceType = body.sourceType === "recording" ? "recording" : "upload";
        const titleOverride = body.title?.trim();
        const result = await generateMomFromSource(auth.userId, {
          buffer,
          fileName: body.fileName || "meeting-source",
          mimeType: body.mimeType || "",
          sourceType,
          languageHint: body.languageHint || "auto",
          ...(titleOverride ? { titleOverride } : {}),
        });
        return json(result, 201);
      }

      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return json({ ok: false, error: "No audio or document file provided." }, 400);
      }
      const sourceTypeRaw = String(formData.get("sourceType") ?? "upload");
      const sourceType = sourceTypeRaw === "recording" ? "recording" : "upload";
      const languageHint = String(formData.get("languageHint") ?? "auto");
      const titleOverride = String(formData.get("title") ?? "").trim();

      const result = await generateMomFromSource(auth.userId, {
        file,
        sourceType,
        languageHint,
        ...(titleOverride ? { titleOverride } : {}),
      });
      return json(result, 201);
    }

    if (path === "/api/mom/documents" && (request.method === "POST" || request.method === "PUT")) {
      const payload = await request.json();
      const { saveMomDocumentRecord } = await import("./lib/mom.server.ts");
      const result = await saveMomDocumentRecord(auth.userId, auth.role, payload);
      return json(result, 200);
    }

    if (path.startsWith("/api/mom/documents/") && request.method === "DELETE") {
      const docId = path.slice("/api/mom/documents/".length);
      const { deleteMomDocumentRecord } = await import("./lib/mom.server.ts");
      const result = await deleteMomDocumentRecord(auth.userId, auth.role, docId);
      return json(result, 200);
    }

    if (path === "/api/mom/assets" && request.method === "POST") {
      const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
      const { saveMomBrandAssetUpload } = await import("./lib/mom.server.ts");

      if (contentType.includes("application/json")) {
        const body = (await request.json()) as {
          base64Data?: string;
          fileName?: string;
          mimeType?: string;
          kind?: string;
          name?: string;
          letterheadMode?: string;
        };
        if (!body.base64Data || typeof body.base64Data !== "string") {
          return json({ ok: false, error: "Please select an image file to upload." }, 400);
        }
        if (body.kind !== "letterhead" && body.kind !== "stamp" && body.kind !== "signature") {
          return json({ ok: false, error: "Invalid asset type." }, 400);
        }
        const rawB64 = body.base64Data.includes(",")
          ? body.base64Data.slice(body.base64Data.indexOf(",") + 1)
          : body.base64Data;
        const buffer = Buffer.from(rawB64, "base64");
        const letterheadMode = body.letterheadMode === "fullpage" ? "fullpage" : "header";
        const assetName = body.name?.trim();
        const result = await saveMomBrandAssetUpload(auth.userId, {
          buffer,
          fileName: body.fileName || `${body.kind}.png`,
          mimeType: body.mimeType || "image/png",
          kind: body.kind,
          ...(assetName ? { name: assetName } : {}),
          letterheadMode,
        });
        return json(result, 201);
      }

      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return json({ ok: false, error: "Please select an image file to upload." }, 400);
      }
      const kindRaw = String(formData.get("kind") ?? "");
      if (kindRaw !== "letterhead" && kindRaw !== "stamp" && kindRaw !== "signature") {
        return json({ ok: false, error: "Invalid asset type." }, 400);
      }
      const name = String(formData.get("name") ?? "").trim();
      const modeRaw = String(formData.get("letterheadMode") ?? "header");
      const letterheadMode = modeRaw === "fullpage" ? "fullpage" : "header";

      const result = await saveMomBrandAssetUpload(auth.userId, {
        file,
        kind: kindRaw,
        ...(name ? { name } : {}),
        letterheadMode,
      });
      return json(result, 201);
    }

    if (path.startsWith("/api/mom/assets/") && request.method === "DELETE") {
      const assetId = path.slice("/api/mom/assets/".length);
      const { deleteMomBrandAssetRecord } = await import("./lib/mom.server.ts");
      const result = await deleteMomBrandAssetRecord(auth.userId, auth.role, assetId);
      return json(result, 200);
    }

    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (err) {
    console.error("[MOM API Error]", err);
    const message = err instanceof Error ? err.message : "MOM request failed.";
    const lower = message.toLowerCase();
    const status = message.startsWith("Forbidden:")
      ? 403
      : lower.includes("high demand") || lower.includes("unavailable")
        ? 503
        : lower.includes("rate limit") || lower.includes("quota")
          ? 429
          : 400;
    return json({ ok: false, error: message }, status);
  }
}

async function handleUsersApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/users") {
    return null;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  const { resolveAuthenticatedUserFromRequest } = await import("./lib/auth.server.ts");
  const auth = await resolveAuthenticatedUserFromRequest(request);
  if (!auth) {
    return json({ ok: false, error: "Unauthorized: Please sign in to continue." }, 401);
  }

  try {
    if (request.method === "GET") {
      const { listUsersRecord } = await import("./lib/accounts.server.ts");
      const users = await listUsersRecord({ userId: auth.userId, role: auth.role });
      return json({ ok: true, users }, 200);
    }

    if (request.method === "POST") {
      const originHeader = request.headers.get("origin");
      const hostHeader =
        request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
      const hasSessionHeader = Boolean(request.headers.get("x-sace-session"));
      if (originHeader && hostHeader && !hasSessionHeader) {
        try {
          if (new URL(originHeader).host !== hostHeader) {
            return json({ ok: false, error: "Forbidden: Cross-origin request rejected." }, 403);
          }
        } catch {
          return json({ ok: false, error: "Forbidden: Invalid origin header." }, 403);
        }
      }

      const payload = await request.json();
      const { createAccountRecord } = await import("./lib/accounts.server.ts");
      const result = await createAccountRecord({ userId: auth.userId, role: auth.role }, payload);
      return json(result, 201);
    }

    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Account request failed.";
    const status = message.startsWith("Forbidden:")
      ? 403
      : message.toLowerCase().includes("already exists")
        ? 409
        : 400;
    return json({ ok: false, error: message }, status);
  }
}

async function handleLeaveEmailDecisionApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/leave/email-decision") {
    return null;
  }
  const { handleLeaveEmailDecisionRequest } = await import("./lib/portal-notifications.server.ts");
  return handleLeaveEmailDecisionRequest(request);
}

async function handleSmtpApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== "/api/smtp" &&
    url.pathname !== "/api/smtp/test" &&
    url.pathname !== "/api/smtp/teams" &&
    url.pathname !== "/api/smtp/teams/test"
  ) {
    return null;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  const { resolveAuthenticatedUserFromRequest } = await import("./lib/auth.server.ts");
  const auth = await resolveAuthenticatedUserFromRequest(request);
  if (!auth) {
    return json({ ok: false, error: "Unauthorized: Please sign in to continue." }, 401);
  }

  if (request.method !== "GET") {
    const originHeader = request.headers.get("origin");
    const hostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    const hasSessionHeader = Boolean(request.headers.get("x-sace-session"));
    if (originHeader && hostHeader && !hasSessionHeader) {
      try {
        if (new URL(originHeader).host !== hostHeader) {
          return json({ ok: false, error: "Forbidden: Cross-origin request rejected." }, 403);
        }
      } catch {
        return json({ ok: false, error: "Forbidden: Invalid origin header." }, 403);
      }
    }
  }

  try {
    if (url.pathname === "/api/smtp" && request.method === "GET") {
      const { getMySmtpConfigRecord } = await import("./lib/smtp.server.ts");
      const config = await getMySmtpConfigRecord(auth.userId);
      return json({ ok: true, config }, 200);
    }

    if (url.pathname === "/api/smtp" && (request.method === "POST" || request.method === "PUT")) {
      const payload = await request.json();
      const { saveMySmtpConfigRecord } = await import("./lib/smtp.server.ts");
      const result = await saveMySmtpConfigRecord(auth.userId, payload);
      return json(result, 200);
    }

    if (url.pathname === "/api/smtp" && request.method === "DELETE") {
      const { deleteMySmtpConfigRecord } = await import("./lib/smtp.server.ts");
      const result = await deleteMySmtpConfigRecord(auth.userId);
      return json(result, 200);
    }

    if (url.pathname === "/api/smtp/test" && request.method === "POST") {
      const payload = await request.json();
      const { testMySmtpConfigRecord } = await import("./lib/smtp.server.ts");
      const result = await testMySmtpConfigRecord(auth.userId, payload);
      return json(result, 200);
    }

    if (
      url.pathname === "/api/smtp/teams" &&
      (request.method === "POST" || request.method === "PUT")
    ) {
      const payload = await request.json();
      const { saveMyTeamsConfigRecord } = await import("./lib/smtp.server.ts");
      const result = await saveMyTeamsConfigRecord(auth.userId, payload);
      return json(result, 200);
    }

    if (url.pathname === "/api/smtp/teams" && request.method === "DELETE") {
      const { deleteMyTeamsConfigRecord } = await import("./lib/smtp.server.ts");
      const result = await deleteMyTeamsConfigRecord(auth.userId);
      return json(result, 200);
    }

    if (url.pathname === "/api/smtp/teams/test" && request.method === "POST") {
      const payload = await request.json();
      const { testMyTeamsConfigRecord } = await import("./lib/smtp.server.ts");
      const result = await testMyTeamsConfigRecord(auth.userId, payload);
      return json(result, 200);
    }

    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (err) {
    console.error("[SMTP API Error]", err);
    const message = err instanceof Error ? err.message : "SMTP request failed.";
    const lower = message.toLowerCase();
    const status = lower.includes("too many requests") ? 429 : 400;
    return json({ ok: false, error: message, message }, status);
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const leaveDecisionResponse = await handleLeaveEmailDecisionApi(request);
      if (leaveDecisionResponse) {
        return withSecurityHeaders(leaveDecisionResponse);
      }
      const smtpResponse = await handleSmtpApi(request);
      if (smtpResponse) {
        return withSecurityHeaders(smtpResponse);
      }
      const usersResponse = await handleUsersApi(request);
      if (usersResponse) {
        return withSecurityHeaders(usersResponse);
      }
      const momResponse = await handleMomApi(request);
      if (momResponse) {
        return withSecurityHeaders(momResponse);
      }
      const messageUploadResponse = await handleMessagesUploadApi(request);
      if (messageUploadResponse) {
        return withSecurityHeaders(messageUploadResponse);
      }
      const apiResponse = await handleBattalionApi(request);
      if (apiResponse) {
        return withSecurityHeaders(apiResponse);
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response, request);
      return withSecurityHeaders(normalized);
    } catch (error) {
      console.error(error);
      if (isJsonOrRpcRequest(request)) {
        const message = error instanceof Error ? error.message : "Internal server error.";
        return withSecurityHeaders(
          new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json; charset=utf-8" },
          }),
        );
      }
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
