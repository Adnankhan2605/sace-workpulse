import { createServerFn } from "@tanstack/react-start";
import { requirePortalAuth } from "./portal-auth.middleware.ts";
import {
  SaveSmtpConfigSchema,
  TestSmtpConfigSchema,
  type PublicSmtpConfig,
  type SaveSmtpConfigInput,
  type TestSmtpConfigInput,
} from "./smtp.schemas.ts";

export type { PublicSmtpConfig, SaveSmtpConfigInput, TestSmtpConfigInput };

export const getMySmtpConfig = createServerFn({ method: "GET" })
  .middleware([requirePortalAuth])
  .handler(async ({ context }) => {
    const { getMySmtpConfigRecord } = await import("./smtp.server.ts");
    const config = await getMySmtpConfigRecord(context.userId);
    return { ok: true as const, config };
  });

export const saveMySmtpConfig = createServerFn({ method: "POST" })
  .middleware([requirePortalAuth])
  .inputValidator((raw: unknown) => SaveSmtpConfigSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { saveMySmtpConfigRecord } = await import("./smtp.server.ts");
    return saveMySmtpConfigRecord(context.userId, data);
  });

export const testMySmtpConfig = createServerFn({ method: "POST" })
  .middleware([requirePortalAuth])
  .inputValidator((raw: unknown) => TestSmtpConfigSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { testMySmtpConfigRecord } = await import("./smtp.server.ts");
    return testMySmtpConfigRecord(context.userId, data);
  });

export const deleteMySmtpConfig = createServerFn({ method: "POST" })
  .middleware([requirePortalAuth])
  .handler(async ({ context }) => {
    const { deleteMySmtpConfigRecord } = await import("./smtp.server.ts");
    return deleteMySmtpConfigRecord(context.userId);
  });
