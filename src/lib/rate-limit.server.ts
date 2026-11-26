import { getRequest, getRequestIP } from "@tanstack/react-start/server";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastPrune = Date.now();

function pruneExpired(now: number) {
  if (now - lastPrune < 60_000 && buckets.size < 5000) return;
  lastPrune = now;
  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function getClientIpFromRequest(req?: Request | null): string {
  const fwd = req?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd;
  const realIp = req?.headers?.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return getClientIp();
}

export function getClientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip) return ip;
    const req = getRequest();
    const fwd = req?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
    return fwd || "unknown";
  } catch {
    return "unknown";
  }
}

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number; message?: string },
): { allowed: true } | { allowed: false; message: string } {
  const now = Date.now();
  pruneExpired(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true };
  }

  if (existing.count >= options.limit) {
    const retrySec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return {
      allowed: false,
      message:
        options.message ??
        `Too many requests. Please wait ${retrySec} second${retrySec === 1 ? "" : "s"} before trying again.`,
    };
  }

  existing.count += 1;
  return { allowed: true };
}

export function assertRateLimit(
  key: string,
  options: { limit: number; windowMs: number; message?: string },
): void {
  const result = checkRateLimit(key, options);
  if (!result.allowed) {
    throw new Error(result.message);
  }
}
