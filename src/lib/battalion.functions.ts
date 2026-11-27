import { createServerFn } from "@tanstack/react-start";
import { requirePortalAuth } from "./portal-auth.middleware.ts";
import { CreateBattalionSchema, DeleteBattalionSchema, UpdatePresenceSchema } from "./battalion.ts";

export const updateMyPresence = createServerFn({ method: "POST" })
  .middleware([requirePortalAuth])
  .inputValidator((raw: unknown) => UpdatePresenceSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { saveUserPresenceRecord } = await import("./battalion.server.ts");
    return saveUserPresenceRecord(context.userId, data, context.role);
  });

export const getBattalions = createServerFn({ method: "GET" })
  .middleware([requirePortalAuth])
  .handler(async ({ context }) => {
    const { fetchPopulatedBattalions } = await import("./battalion.server.ts");
    return fetchPopulatedBattalions(context.userId, context.role);
  });

export const createBattalion = createServerFn({ method: "POST" })
  .middleware([requirePortalAuth])
  .inputValidator((raw: unknown) => CreateBattalionSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { createBattalionRecord } = await import("./battalion.server.ts");
    return createBattalionRecord(context.userId, context.role, data);
  });

export const deleteBattalion = createServerFn({ method: "POST" })
  .middleware([requirePortalAuth])
  .inputValidator((raw: unknown) => DeleteBattalionSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { deleteBattalionRecord } = await import("./battalion.server.ts");
    return deleteBattalionRecord(context.userId, context.role, data);
  });
