import { createServerFn } from "@tanstack/react-start";
import { requirePortalAuth } from "./portal-auth.middleware.ts";
import {
  CreateAccountSchema,
  DeleteAccountSchema,
  SaveAccountSchema,
  SaveAdminPermsSchema,
  type CreateAccountInput,
  type SaveAccountInput,
} from "./accounts.schemas.ts";

export type { CreateAccountInput, SaveAccountInput };

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requirePortalAuth])
  .inputValidator((raw: unknown) => CreateAccountSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { createAccountRecord } = await import("./accounts.server.ts");
    return createAccountRecord({ userId: context.userId, role: context.role }, data);
  });

export const saveAccount = createServerFn({ method: "POST" })
  .middleware([requirePortalAuth])
  .inputValidator((raw: unknown) => SaveAccountSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { saveAccountRecord } = await import("./accounts.server.ts");
    return saveAccountRecord({ userId: context.userId, role: context.role }, data);
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requirePortalAuth])
  .inputValidator((raw: unknown) => DeleteAccountSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { deleteAccountRecord } = await import("./accounts.server.ts");
    return deleteAccountRecord({ userId: context.userId, role: context.role }, data);
  });

export const saveAdminPerms = createServerFn({ method: "POST" })
  .middleware([requirePortalAuth])
  .inputValidator((raw: unknown) => SaveAdminPermsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { saveAdminPermsRecord } = await import("./accounts.server.ts");
    return saveAdminPermsRecord({ userId: context.userId, role: context.role }, data);
  });
