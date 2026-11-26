import { z } from "zod";

export type SmtpEncryptionMode = "starttls" | "ssl_tls" | "none";
export type IntegrationPresetKind = "smtp" | "teams";

export interface SmtpProviderPreset {
  id: string;
  label: string;
  kind: IntegrationPresetKind;
  host: string;
  port: number;
  encryption: SmtpEncryptionMode;
  hint: string;
}

export const SMTP_PROVIDER_PRESETS: readonly SmtpProviderPreset[] = [
  {
    id: "custom",
    label: "Custom SMTP",
    kind: "smtp",
    host: "",
    port: 587,
    encryption: "starttls",
    hint: "Any standard SMTP relay or mail server",
  },
  {
    id: "google",
    label: "Google / Gmail",
    kind: "smtp",
    host: "smtp.gmail.com",
    port: 587,
    encryption: "starttls",
    hint: "Use a 16-character Google App Password when 2-Step Verification is enabled",
  },
  {
    id: "outlook",
    label: "Outlook",
    kind: "smtp",
    host: "smtp-mail.outlook.com",
    port: 587,
    encryption: "starttls",
    hint: "Use smtp-mail.outlook.com (or smtp.office365.com for work Microsoft 365 mailboxes with Authenticated SMTP enabled)",
  },
  {
    id: "teams",
    label: "Microsoft Teams",
    kind: "teams",
    host: "",
    port: 587,
    encryption: "starttls",
    hint: "Connect a Microsoft Teams Incoming Webhook or Workflows URL to post alerts directly to your Teams channel",
  },
] as const;

export const SaveSmtpConfigSchema = z.object({
  providerLabel: z.string().trim().min(1).max(64).default("Custom SMTP"),
  host: z
    .string()
    .trim()
    .min(3, "Enter a valid SMTP server hostname.")
    .max(255)
    .refine((v) => !/\s/.test(v) && !v.includes("://") && !v.includes("/"), {
      message: "Enter a hostname only (without http:// or paths).",
    }),
  port: z.number().int().min(1, "Port must be between 1 and 65535.").max(65535),
  encryption: z.enum(["starttls", "ssl_tls", "none"]),
  username: z.string().trim().min(1, "SMTP username is required.").max(255),
  password: z.string().max(512).optional(),
  fromName: z.string().trim().min(1, "Sender name is required.").max(120),
  fromEmail: z.string().trim().email("Enter a valid sender email address.").max(160),
  replyTo: z
    .string()
    .trim()
    .max(160)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Reply-To must be a valid email address.",
    })
    .optional()
    .default(""),
  enabled: z.boolean().default(true),
});

export type SaveSmtpConfigInput = z.infer<typeof SaveSmtpConfigSchema>;

export const TestSmtpConfigSchema = SaveSmtpConfigSchema.extend({
  mode: z.enum(["verify", "send_test"]).default("verify"),
  testRecipient: z
    .string()
    .trim()
    .max(160)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Enter a valid recipient email for the test mail.",
    })
    .optional()
    .default(""),
});

export type TestSmtpConfigInput = z.infer<typeof TestSmtpConfigSchema>;

export const SaveTeamsConfigSchema = z.object({
  webhookUrl: z
    .string()
    .trim()
    .max(1024)
    .refine(
      (v) => v === "" || /^https:\/\/[a-z0-9.-]+(?:\/.*)?$/i.test(v),
      "Enter a valid HTTPS Microsoft Teams webhook URL.",
    )
    .optional(),
  enabled: z.boolean().default(true),
});

export type SaveTeamsConfigInput = z.infer<typeof SaveTeamsConfigSchema>;

export const TestTeamsConfigSchema = z.object({
  webhookUrl: z
    .string()
    .trim()
    .max(1024)
    .refine(
      (v) => v === "" || /^https:\/\/[a-z0-9.-]+(?:\/.*)?$/i.test(v),
      "Enter a valid HTTPS Microsoft Teams webhook URL.",
    )
    .optional(),
});

export type TestTeamsConfigInput = z.infer<typeof TestTeamsConfigSchema>;

export type WhatsAppIntegrationMode = "cloud_api" | "webhook";

export const SaveWhatsAppConfigSchema = z.object({
  mode: z.enum(["cloud_api", "webhook"]).default("cloud_api"),
  phoneNumberId: z.string().trim().max(64).optional().default(""),
  recipientPhone: z
    .string()
    .trim()
    .max(32)
    .refine(
      (v) => v === "" || /^\+?[0-9\s()-]{7,20}$/.test(v),
      "Enter a valid WhatsApp phone number with country code (e.g. +919876543210).",
    )
    .optional()
    .default(""),
  accessToken: z.string().trim().max(1024).optional(),
  webhookUrl: z
    .string()
    .trim()
    .max(1024)
    .refine(
      (v) => v === "" || /^https:\/\/[a-z0-9.-]+(?:\/.*)?$/i.test(v),
      "Enter a valid HTTPS WhatsApp webhook URL.",
    )
    .optional(),
  enabled: z.boolean().default(true),
});

export type SaveWhatsAppConfigInput = z.infer<typeof SaveWhatsAppConfigSchema>;

export const TestWhatsAppConfigSchema = SaveWhatsAppConfigSchema;

export type TestWhatsAppConfigInput = z.infer<typeof TestWhatsAppConfigSchema>;

export interface PublicSmtpConfig {
  configured: boolean;
  providerLabel: string;
  host: string;
  port: number;
  encryption: SmtpEncryptionMode;
  username: string;
  hasPassword: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  enabled: boolean;
  lastVerifiedAt: string | null;
  lastTestStatus: "verified" | "failed" | null;
  lastTestError: string | null;
  hasTeamsWebhook: boolean;
  teamsEnabled: boolean;
  teamsLastVerifiedAt: string | null;
  teamsLastTestStatus: "verified" | "failed" | null;
  teamsLastTestError: string | null;
  hasWhatsAppConfig: boolean;
  whatsappMode: WhatsAppIntegrationMode;
  whatsappPhoneNumberId: string;
  whatsappRecipientPhone: string;
  whatsappEnabled: boolean;
  whatsappLastVerifiedAt: string | null;
  whatsappLastTestStatus: "verified" | "failed" | null;
  whatsappLastTestError: string | null;
  updatedAt: string | null;
}
