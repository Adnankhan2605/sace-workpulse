import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const LoginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your username or email.").max(160),
  password: z.string().min(1, "Enter your password.").max(128),
});

export const loginPortal = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => raw as { identifier: string; password: string })
  .handler(async ({ data }) => {
    try {
      const parsed = LoginSchema.safeParse(data);
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Enter your username or email and password.",
        };
      }

      const { authenticatePortalLogin, setSessionCookie } = await import("./auth.server.ts");
      let req: Request | null = null;
      try {
        req = getRequest() ?? null;
      } catch {
        req = null;
      }

      const result = await authenticatePortalLogin(parsed.data, req);
      if (!result.ok) {
        return { ok: false as const, error: result.error };
      }

      setSessionCookie(result.user.id, result.sessionToken);
      return {
        ok: true as const,
        user: result.user,
        sessionToken: result.sessionToken,
      };
    } catch (err) {
      console.error("[SACE Auth] loginPortal error:", err);
      return {
        ok: false as const,
        error: "Unable to sign in right now. Please try again in a moment.",
      };
    }
  });

export const logoutPortal = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { clearSessionCookie } = await import("./auth.server.ts");
    clearSessionCookie();
  } catch (err) {
    console.error("[SACE Auth] logoutPortal error:", err);
  }
  return { ok: true as const };
});

export const getCurrentSession = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { resolveAuthenticatedUser } = await import("./auth.server.ts");
    const auth = await resolveAuthenticatedUser();
    if (!auth) {
      return { authenticated: false as const, user: null };
    }
    return { authenticated: true as const, user: auth.user };
  } catch (err) {
    console.error("[SACE Auth] getCurrentSession error:", err);
    return { authenticated: false as const, user: null };
  }
});
