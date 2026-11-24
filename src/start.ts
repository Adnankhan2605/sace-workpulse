import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { attachPortalSession } from "@/lib/portal-session-client";

function isJsonOrRpcRequest(request: Request): boolean {
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/_serverFn") || pathname.startsWith("/api/")) {
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

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    if (isJsonOrRpcRequest(request)) {
      const message = error instanceof Error ? error.message : "Internal server error.";
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
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, attachPortalSession],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
