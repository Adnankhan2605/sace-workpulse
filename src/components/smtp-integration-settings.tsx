import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  SMTP_PROVIDER_PRESETS,
  SaveSmtpConfigSchema,
  SaveTeamsConfigSchema,
  SaveWhatsAppConfigSchema,
  TestSmtpConfigSchema,
  TestTeamsConfigSchema,
  TestWhatsAppConfigSchema,
  type PublicSmtpConfig,
  type SmtpEncryptionMode,
  type WhatsAppIntegrationMode,
} from "@/lib/smtp.schemas";
import { getClientSessionToken } from "@/lib/portal-session-client";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

async function smtpApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getClientSessionToken();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (token) {
    headers.set("x-sace-session", token);
  }

  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const raw = await res.text();
    if (raw.trim().startsWith("<")) {
      throw new Error(
        `Server returned an unexpected error page (HTTP ${res.status}). Please refresh the page and sign in again.`,
      );
    }
    throw new Error(raw.slice(0, 240) || `Request failed (HTTP ${res.status}).`);
  }

  const payload = (await res.json()) as T & { ok?: boolean; error?: string; message?: string };
  if (!res.ok) {
    throw new Error(payload.error || payload.message || `Request failed (HTTP ${res.status}).`);
  }
  return payload;
}

export function SmtpIntegrationSettings() {
  const { me, log } = useApp();

  const [loading, setLoading] = React.useState(true);
  const [config, setConfig] = React.useState<PublicSmtpConfig | null>(null);

  const [activeChannel, setActiveChannel] = React.useState<"smtp" | "teams" | "whatsapp">("smtp");
  const [selectedPresetId, setSelectedPresetId] = React.useState<string>("custom");
  const [providerLabel, setProviderLabel] = React.useState("Custom SMTP");
  const [host, setHost] = React.useState("");
  const [port, setPort] = React.useState<string>("587");
  const [encryption, setEncryption] = React.useState<SmtpEncryptionMode>("starttls");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [fromName, setFromName] = React.useState(me?.fullName ?? "");
  const [fromEmail, setFromEmail] = React.useState(me?.email ?? "");
  const [replyTo, setReplyTo] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [testRecipient, setTestRecipient] = React.useState(me?.email ?? "");

  // Microsoft Teams webhook state
  const [teamsWebhookUrl, setTeamsWebhookUrl] = React.useState("");
  const [showTeamsWebhook, setShowTeamsWebhook] = React.useState(false);
  const [teamsEnabled, setTeamsEnabled] = React.useState(true);
  const [teamsSaving, setTeamsSaving] = React.useState(false);
  const [teamsTesting, setTeamsTesting] = React.useState(false);
  const [teamsDeleting, setTeamsDeleting] = React.useState(false);
  const [teamsFeedback, setTeamsFeedback] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // WhatsApp integration state
  const [whatsappMode, setWhatsappMode] = React.useState<WhatsAppIntegrationMode>("cloud_api");
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = React.useState("");
  const [whatsappRecipientPhone, setWhatsappRecipientPhone] = React.useState("");
  const [whatsappAccessToken, setWhatsappAccessToken] = React.useState("");
  const [whatsappWebhookUrl, setWhatsappWebhookUrl] = React.useState("");
  const [showWhatsAppSecret, setShowWhatsAppSecret] = React.useState(false);
  const [whatsappEnabled, setWhatsappEnabled] = React.useState(true);
  const [whatsappSaving, setWhatsappSaving] = React.useState(false);
  const [whatsappTesting, setWhatsappTesting] = React.useState(false);
  const [whatsappDeleting, setWhatsappDeleting] = React.useState(false);
  const [whatsappFeedback, setWhatsappFeedback] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [saving, setSaving] = React.useState(false);
  const [testingMode, setTestingMode] = React.useState<"verify" | "send_test" | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [testFeedback, setTestFeedback] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const applyConfigToForm = React.useCallback(
    (cfg: PublicSmtpConfig, preserveSelectedPreset = false) => {
      setConfig(cfg);
      setProviderLabel(cfg.providerLabel || "Custom SMTP");
      setHost(cfg.host || "");
      setPort(String(cfg.port || 587));
      setEncryption(cfg.encryption || "starttls");
      setUsername(cfg.username || "");
      setPassword("");
      setFromName(cfg.fromName || me?.fullName || "");
      setFromEmail(cfg.fromEmail || me?.email || "");
      setReplyTo(cfg.replyTo || "");
      setEnabled(cfg.configured ? cfg.enabled : true);
      setTestRecipient((prev) => prev || cfg.fromEmail || me?.email || "");
      setTeamsWebhookUrl("");
      setTeamsEnabled(cfg.hasTeamsWebhook ? cfg.teamsEnabled : true);
      setWhatsappMode(cfg.whatsappMode || "cloud_api");
      setWhatsappPhoneNumberId(cfg.whatsappPhoneNumberId || "");
      setWhatsappRecipientPhone(cfg.whatsappRecipientPhone || "");
      setWhatsappAccessToken("");
      setWhatsappWebhookUrl("");
      setWhatsappEnabled(cfg.hasWhatsAppConfig ? cfg.whatsappEnabled : true);

      if (!preserveSelectedPreset) {
        if (!cfg.configured && cfg.hasTeamsWebhook) {
          setActiveChannel("teams");
        } else if (!cfg.configured && !cfg.hasTeamsWebhook && cfg.hasWhatsAppConfig) {
          setActiveChannel("whatsapp");
        }
        const matched = SMTP_PROVIDER_PRESETS.find(
          (p) => p.kind === "smtp" && p.label === cfg.providerLabel,
        );
        setSelectedPresetId(matched?.id ?? "custom");
      }
    },
    [me?.email, me?.fullName],
  );

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void smtpApiFetch<{ ok: true; config: PublicSmtpConfig }>("/api/smtp", { method: "GET" })
      .then((res) => {
        if (cancelled) return;
        applyConfigToForm(res.config);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Could not load integration settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyConfigToForm]);

  const mailPresets = React.useMemo(
    () => SMTP_PROVIDER_PRESETS.filter((p) => p.kind === "smtp"),
    [],
  );

  const activePreset = React.useMemo(
    () => mailPresets.find((p) => p.id === selectedPresetId) ?? mailPresets[0],
    [mailPresets, selectedPresetId],
  );

  const isTeamsMode = activeChannel === "teams";
  const isWhatsAppMode = activeChannel === "whatsapp";

  function selectChannel(channel: "smtp" | "teams" | "whatsapp") {
    setActiveChannel(channel);
    setTestFeedback(null);
    setTeamsFeedback(null);
    setWhatsappFeedback(null);
  }

  function selectPreset(presetId: string) {
    const preset = mailPresets.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPresetId(preset.id);
    setTestFeedback(null);
    setProviderLabel(preset.label);
    setPort(String(preset.port));
    setEncryption(preset.encryption);
    if (preset.host) {
      setHost(preset.host);
    }
  }

  function handleEncryptionChange(next: SmtpEncryptionMode) {
    setEncryption(next);
    if (next === "ssl_tls" && (port === "587" || port === "25")) {
      setPort("465");
    } else if (next === "starttls" && (port === "465" || port === "25")) {
      setPort("587");
    } else if (next === "none" && (port === "587" || port === "465")) {
      setPort("25");
    }
  }

  function buildPayload() {
    const parsedPort = Number(port);
    return {
      providerLabel: providerLabel.trim() || "Custom SMTP",
      host: host.trim(),
      port: Number.isFinite(parsedPort) ? Math.round(parsedPort) : 0,
      encryption,
      username: username.trim(),
      password: password.trim() || undefined,
      fromName: fromName.trim(),
      fromEmail: fromEmail.trim(),
      replyTo: replyTo.trim(),
      enabled,
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const raw = buildPayload();
    const parsed = SaveSmtpConfigSchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check your SMTP fields.");
      return;
    }
    if (!raw.password && !config?.hasPassword) {
      toast.error("Enter your SMTP password before saving.");
      return;
    }

    setSaving(true);
    setTestFeedback(null);
    try {
      const res = await smtpApiFetch<{ ok: true; config: PublicSmtpConfig }>("/api/smtp", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      applyConfigToForm(res.config, true);
      log(
        "smtp_updated",
        `Saved personal SMTP integration (${res.config.host}:${res.config.port})`,
      );
      toast.success("Personal SMTP settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save SMTP settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(mode: "verify" | "send_test") {
    const raw = {
      ...buildPayload(),
      mode,
      testRecipient: testRecipient.trim() || fromEmail.trim(),
    };
    const parsed = TestSmtpConfigSchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please complete your SMTP fields first.");
      return;
    }
    if (!raw.password && !config?.hasPassword) {
      toast.error("Enter your SMTP password before testing the connection.");
      return;
    }
    if (mode === "send_test" && !parsed.data.testRecipient) {
      toast.error("Enter a recipient email address for the test mail.");
      return;
    }

    setTestingMode(mode);
    setTestFeedback(null);
    try {
      const res = await smtpApiFetch<{
        ok: boolean;
        message: string;
        config?: PublicSmtpConfig;
      }>("/api/smtp/test", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      if (res.config) {
        setConfig(res.config);
      }
      setTestFeedback({ ok: res.ok, message: res.message });
      if (res.ok) {
        log(
          "smtp_tested",
          mode === "send_test"
            ? `Sent SMTP test mail to ${parsed.data.testRecipient}`
            : `Verified SMTP connection (${parsed.data.host}:${parsed.data.port})`,
        );
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "SMTP test failed.";
      setTestFeedback({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setTestingMode(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setTestFeedback(null);
    try {
      const res = await smtpApiFetch<{ ok: true; config: PublicSmtpConfig }>("/api/smtp", {
        method: "DELETE",
      });
      applyConfigToForm(res.config, true);
      log("smtp_deleted", "Removed personal SMTP integration");
      toast.success("Personal SMTP integration removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove SMTP integration.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveTeams(e: React.FormEvent) {
    e.preventDefault();
    const raw = {
      webhookUrl: teamsWebhookUrl.trim() || undefined,
      enabled: teamsEnabled,
    };
    const parsed = SaveTeamsConfigSchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? "Please check your Microsoft Teams webhook URL.",
      );
      return;
    }
    if (!raw.webhookUrl && !config?.hasTeamsWebhook) {
      toast.error("Enter a Microsoft Teams webhook URL before saving.");
      return;
    }

    setTeamsSaving(true);
    setTeamsFeedback(null);
    try {
      const res = await smtpApiFetch<{ ok: true; config: PublicSmtpConfig }>("/api/smtp/teams", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      applyConfigToForm(res.config, true);
      log("teams_updated", "Saved Microsoft Teams webhook integration");
      toast.success("Microsoft Teams settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save Microsoft Teams settings.");
    } finally {
      setTeamsSaving(false);
    }
  }

  async function handleTestTeams() {
    const raw = {
      webhookUrl: teamsWebhookUrl.trim() || undefined,
    };
    const parsed = TestTeamsConfigSchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? "Enter a valid HTTPS Microsoft Teams webhook URL.",
      );
      return;
    }
    if (!raw.webhookUrl && !config?.hasTeamsWebhook) {
      toast.error("Enter a Microsoft Teams webhook URL before testing.");
      return;
    }

    setTeamsTesting(true);
    setTeamsFeedback(null);
    try {
      const res = await smtpApiFetch<{
        ok: boolean;
        message: string;
        config?: PublicSmtpConfig;
      }>("/api/smtp/teams/test", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      if (res.config) {
        setConfig(res.config);
      }
      setTeamsFeedback({ ok: res.ok, message: res.message });
      if (res.ok) {
        log("teams_tested", "Verified Microsoft Teams webhook delivery");
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microsoft Teams test failed.";
      setTeamsFeedback({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setTeamsTesting(false);
    }
  }

  async function handleDeleteTeams() {
    setTeamsDeleting(true);
    setTeamsFeedback(null);
    try {
      const res = await smtpApiFetch<{ ok: true; config: PublicSmtpConfig }>("/api/smtp/teams", {
        method: "DELETE",
      });
      applyConfigToForm(res.config, true);
      log("teams_deleted", "Removed Microsoft Teams integration");
      toast.success("Microsoft Teams integration removed.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not remove Microsoft Teams integration.",
      );
    } finally {
      setTeamsDeleting(false);
    }
  }

  function buildWhatsAppPayload() {
    return {
      mode: whatsappMode,
      phoneNumberId: whatsappMode === "cloud_api" ? whatsappPhoneNumberId.trim() : "",
      recipientPhone: whatsappRecipientPhone.trim(),
      accessToken:
        whatsappMode === "cloud_api" ? whatsappAccessToken.trim() || undefined : undefined,
      webhookUrl: whatsappMode === "webhook" ? whatsappWebhookUrl.trim() || undefined : undefined,
      enabled: whatsappEnabled,
    };
  }

  async function handleSaveWhatsApp(e: React.FormEvent) {
    e.preventDefault();
    const raw = buildWhatsAppPayload();
    const parsed = SaveWhatsAppConfigSchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check your WhatsApp fields.");
      return;
    }

    if (whatsappMode === "cloud_api") {
      if (!raw.phoneNumberId || !/^[0-9]+$/.test(raw.phoneNumberId)) {
        toast.error("Enter a valid numeric Meta WhatsApp Phone Number ID.");
        return;
      }
      if (!raw.recipientPhone) {
        toast.error("Enter a recipient WhatsApp phone number with country code.");
        return;
      }
      if (
        !raw.accessToken &&
        (!config?.hasWhatsAppConfig || config?.whatsappMode !== "cloud_api")
      ) {
        toast.error("Enter your Meta WhatsApp Cloud API Access Token before saving.");
        return;
      }
    } else if (
      !raw.webhookUrl &&
      (!config?.hasWhatsAppConfig || config?.whatsappMode !== "webhook")
    ) {
      toast.error("Enter your WhatsApp webhook URL before saving.");
      return;
    }

    setWhatsappSaving(true);
    setWhatsappFeedback(null);
    try {
      const res = await smtpApiFetch<{ ok: true; config: PublicSmtpConfig }>("/api/smtp/whatsapp", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      applyConfigToForm(res.config, true);
      log(
        "whatsapp_updated",
        `Saved WhatsApp ${res.config.whatsappMode === "webhook" ? "webhook" : "Cloud API"} integration`,
      );
      toast.success("WhatsApp integration settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save WhatsApp settings.");
    } finally {
      setWhatsappSaving(false);
    }
  }

  async function handleTestWhatsApp() {
    const raw = buildWhatsAppPayload();
    const parsed = TestWhatsAppConfigSchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check your WhatsApp fields first.");
      return;
    }

    if (whatsappMode === "cloud_api") {
      if (!raw.phoneNumberId || !/^[0-9]+$/.test(raw.phoneNumberId)) {
        toast.error("Enter a valid numeric Meta WhatsApp Phone Number ID.");
        return;
      }
      if (!raw.recipientPhone) {
        toast.error("Enter a recipient WhatsApp phone number with country code.");
        return;
      }
      if (
        !raw.accessToken &&
        (!config?.hasWhatsAppConfig || config?.whatsappMode !== "cloud_api")
      ) {
        toast.error("Enter your Meta WhatsApp Access Token before testing.");
        return;
      }
    } else if (
      !raw.webhookUrl &&
      (!config?.hasWhatsAppConfig || config?.whatsappMode !== "webhook")
    ) {
      toast.error("Enter your WhatsApp webhook URL before testing.");
      return;
    }

    setWhatsappTesting(true);
    setWhatsappFeedback(null);
    try {
      const res = await smtpApiFetch<{
        ok: boolean;
        message: string;
        config?: PublicSmtpConfig;
      }>("/api/smtp/whatsapp/test", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      if (res.config) {
        setConfig(res.config);
      }
      setWhatsappFeedback({ ok: res.ok, message: res.message });
      if (res.ok) {
        log("whatsapp_tested", "Verified WhatsApp notification delivery");
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "WhatsApp test failed.";
      setWhatsappFeedback({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setWhatsappTesting(false);
    }
  }

  async function handleDeleteWhatsApp() {
    setWhatsappDeleting(true);
    setWhatsappFeedback(null);
    try {
      const res = await smtpApiFetch<{ ok: true; config: PublicSmtpConfig }>("/api/smtp/whatsapp", {
        method: "DELETE",
      });
      applyConfigToForm(res.config, true);
      log("whatsapp_deleted", "Removed WhatsApp integration");
      toast.success("WhatsApp integration removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove WhatsApp integration.");
    } finally {
      setWhatsappDeleting(false);
    }
  }

  const busy =
    saving ||
    testingMode !== null ||
    deleting ||
    teamsSaving ||
    teamsTesting ||
    teamsDeleting ||
    whatsappSaving ||
    whatsappTesting ||
    whatsappDeleting;

  if (loading) {
    return (
      <Card className="max-w-4xl rounded-2xl border-border">
        <CardContent className="flex items-center justify-center gap-2.5 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Loading your mail, Teams &amp; WhatsApp integration settings...
        </CardContent>
      </Card>
    );
  }

  const isConfigured = Boolean(config?.configured);
  const smtpStatusLabel = !isConfigured
    ? "Not Configured"
    : config?.lastTestStatus === "verified"
      ? "Connected & Verified"
      : config?.lastTestStatus === "failed"
        ? "Verification Failed"
        : "Saved (Not Verified)";

  const isTeamsConfigured = Boolean(config?.hasTeamsWebhook);
  const teamsStatusLabel = !isTeamsConfigured
    ? "Not Configured"
    : config?.teamsLastTestStatus === "verified"
      ? "Connected & Verified"
      : config?.teamsLastTestStatus === "failed"
        ? "Verification Failed"
        : "Saved (Not Verified)";

  const isWhatsAppConfigured = Boolean(config?.hasWhatsAppConfig);
  const whatsappStatusLabel = !isWhatsAppConfigured
    ? "Not Configured"
    : config?.whatsappLastTestStatus === "verified"
      ? "Connected & Verified"
      : config?.whatsappLastTestStatus === "failed"
        ? "Verification Failed"
        : "Saved (Not Verified)";

  const activeStatusLabel = isTeamsMode
    ? teamsStatusLabel
    : isWhatsAppMode
      ? whatsappStatusLabel
      : smtpStatusLabel;
  const activeStatusState = isTeamsMode
    ? config?.teamsLastTestStatus
    : isWhatsAppMode
      ? config?.whatsappLastTestStatus
      : config?.lastTestStatus;
  const activeConfigured = isTeamsMode
    ? isTeamsConfigured
    : isWhatsAppMode
      ? isWhatsAppConfigured
      : isConfigured;
  const activeLastVerifiedAt = isTeamsMode
    ? config?.teamsLastVerifiedAt
    : isWhatsAppMode
      ? config?.whatsappLastVerifiedAt
      : config?.lastVerifiedAt;

  return (
    <div className="max-w-4xl space-y-4">
      {/* Top-Level Integration Options: Email (SMTP), Microsoft Teams & WhatsApp */}
      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => selectChannel("smtp")}
          className={cn(
            "flex flex-col justify-between gap-3 rounded-2xl border p-4 text-left transition-colors cursor-pointer",
            activeChannel === "smtp"
              ? "border-primary bg-primary/5 ring-1 ring-primary/20"
              : "border-border bg-card hover:bg-muted/40",
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                activeChannel === "smtp"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Email / SMTP</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Gmail, Outlook, or Custom SMTP for portal mails &amp; reports
              </p>
            </div>
          </div>
          <span
            className={cn(
              "self-start rounded-md border px-2 py-0.5 text-[11px] font-medium",
              !isConfigured
                ? "border-border bg-muted/50 text-muted-foreground"
                : config?.lastTestStatus === "verified"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : config?.lastTestStatus === "failed"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
          >
            {smtpStatusLabel}
          </span>
        </button>

        <button
          type="button"
          onClick={() => selectChannel("teams")}
          className={cn(
            "flex flex-col justify-between gap-3 rounded-2xl border p-4 text-left transition-colors cursor-pointer",
            activeChannel === "teams"
              ? "border-primary bg-primary/5 ring-1 ring-primary/20"
              : "border-border bg-card hover:bg-muted/40",
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                activeChannel === "teams"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Microsoft Teams</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Channel Webhook for team logins, logouts, EOD &amp; leave alerts
              </p>
            </div>
          </div>
          <span
            className={cn(
              "self-start rounded-md border px-2 py-0.5 text-[11px] font-medium",
              !isTeamsConfigured
                ? "border-border bg-muted/50 text-muted-foreground"
                : config?.teamsLastTestStatus === "verified"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : config?.teamsLastTestStatus === "failed"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
          >
            {teamsStatusLabel}
          </span>
        </button>

        <button
          type="button"
          onClick={() => selectChannel("whatsapp")}
          className={cn(
            "flex flex-col justify-between gap-3 rounded-2xl border p-4 text-left transition-colors cursor-pointer",
            activeChannel === "whatsapp"
              ? "border-primary bg-primary/5 ring-1 ring-primary/20"
              : "border-border bg-card hover:bg-muted/40",
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                activeChannel === "whatsapp"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">WhatsApp</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Meta Cloud API or Webhook for instant team &amp; EOD alerts
              </p>
            </div>
          </div>
          <span
            className={cn(
              "self-start rounded-md border px-2 py-0.5 text-[11px] font-medium",
              !isWhatsAppConfigured
                ? "border-border bg-muted/50 text-muted-foreground"
                : config?.whatsappLastTestStatus === "verified"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : config?.whatsappLastTestStatus === "failed"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
          >
            {whatsappStatusLabel}
          </span>
        </button>
      </div>

      <Card className="rounded-2xl border-border">
        <CardContent className="space-y-6 p-5">
          {/* Header & Status Bar */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {isTeamsMode ? (
                  <MessageSquare className="h-5 w-5" />
                ) : isWhatsAppMode ? (
                  <MessageCircle className="h-5 w-5" />
                ) : (
                  <Mail className="h-5 w-5" />
                )}
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-foreground">
                    {isTeamsMode
                      ? "Microsoft Teams Channel Integration"
                      : isWhatsAppMode
                        ? "WhatsApp Integration"
                        : "Personal SMTP Mail Integration"}
                  </h3>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                      !activeConfigured
                        ? "border-border bg-muted/50 text-muted-foreground"
                        : activeStatusState === "verified"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : activeStatusState === "failed"
                            ? "border-destructive/30 bg-destructive/10 text-destructive"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {activeStatusState === "verified" ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : activeStatusState === "failed" ? (
                      <AlertCircle className="h-3 w-3" />
                    ) : null}
                    {activeStatusLabel}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isTeamsMode
                    ? "Post team logins, logouts, daily EOD reports, and leave alerts into your Microsoft Teams channel using a secure webhook URL."
                    : isWhatsAppMode
                      ? "Deliver team logins, logouts, daily EOD digests, and leave alerts to WhatsApp via Meta WhatsApp Cloud API or a custom WhatsApp webhook."
                      : "Connect your own Gmail, Outlook, or custom SMTP mailbox so portal notifications and personal mails deliver reliably. Credentials are encrypted per account."}
                </p>
                {activeLastVerifiedAt && (
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    Last verified {new Date(activeLastVerifiedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Label
                htmlFor={
                  isTeamsMode
                    ? "teams-enabled-toggle"
                    : isWhatsAppMode
                      ? "whatsapp-enabled-toggle"
                      : "smtp-enabled-toggle"
                }
                className="text-xs text-muted-foreground"
              >
                {(isTeamsMode ? teamsEnabled : isWhatsAppMode ? whatsappEnabled : enabled)
                  ? "Enabled"
                  : "Disabled"}
              </Label>
              <Switch
                id={
                  isTeamsMode
                    ? "teams-enabled-toggle"
                    : isWhatsAppMode
                      ? "whatsapp-enabled-toggle"
                      : "smtp-enabled-toggle"
                }
                checked={isTeamsMode ? teamsEnabled : isWhatsAppMode ? whatsappEnabled : enabled}
                onCheckedChange={
                  isTeamsMode ? setTeamsEnabled : isWhatsAppMode ? setWhatsappEnabled : setEnabled
                }
                disabled={busy}
              />
            </div>
          </div>

          {!isTeamsMode &&
            !isWhatsAppMode &&
            config?.lastTestStatus === "failed" &&
            config.lastTestError &&
            !testFeedback && (
              <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Last SMTP connection check failed</p>
                  <p className="mt-0.5 text-destructive/90">{config.lastTestError}</p>
                </div>
              </div>
            )}

          {isTeamsMode &&
            config?.teamsLastTestStatus === "failed" &&
            config.teamsLastTestError &&
            !teamsFeedback && (
              <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Last Teams webhook test failed</p>
                  <p className="mt-0.5 text-destructive/90">{config.teamsLastTestError}</p>
                </div>
              </div>
            )}

          {isWhatsAppMode &&
            config?.whatsappLastTestStatus === "failed" &&
            config.whatsappLastTestError &&
            !whatsappFeedback && (
              <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Last WhatsApp test failed</p>
                  <p className="mt-0.5 text-destructive/90">{config.whatsappLastTestError}</p>
                </div>
              </div>
            )}

          {/* Mail Provider Presets (shown for SMTP integration) */}
          {!isTeamsMode && !isWhatsAppMode && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Mail Provider Preset
              </Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {mailPresets.map((preset) => {
                  const selected = preset.id === selectedPresetId;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={busy}
                      onClick={() => selectPreset(preset.id)}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-colors cursor-pointer",
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-foreground hover:bg-muted/50",
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {activePreset?.hint && (
                <p className="text-[11px] text-muted-foreground">{activePreset.hint}</p>
              )}
            </div>
          )}

          {isTeamsMode ? (
            /* Microsoft Teams Webhook Form */
            <form className="space-y-6" onSubmit={handleSaveTeams}>
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      Teams Channel Webhook URL
                    </h4>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="teams-webhook-url" className="text-xs">
                      Webhook / Workflows URL{" "}
                      {!config?.hasTeamsWebhook && <span className="text-destructive">*</span>}
                    </Label>
                    <div className="relative">
                      <Input
                        id="teams-webhook-url"
                        type={showTeamsWebhook ? "text" : "password"}
                        value={teamsWebhookUrl}
                        onChange={(e) => setTeamsWebhookUrl(e.target.value)}
                        placeholder={
                          config?.hasTeamsWebhook
                            ? "https://•••••••• (leave blank to keep saved)"
                            : "https://prod-xx.westus.logic.azure.com/..."
                        }
                        autoComplete="off"
                        className="pr-10"
                        disabled={busy}
                      />
                      <button
                        type="button"
                        onClick={() => setShowTeamsWebhook((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        aria-label={
                          showTeamsWebhook ? "Hide Teams webhook URL" : "Show Teams webhook URL"
                        }
                      >
                        {showTeamsWebhook ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {config?.hasTeamsWebhook
                        ? "Your Teams webhook URL is encrypted on the server. Leave blank to keep it unchanged."
                        : "Create a Workflow in Microsoft Teams (Post to a channel when a webhook request is received) and paste its HTTPS URL."}
                    </p>
                  </div>

                  {teamsFeedback && (
                    <div
                      className={cn(
                        "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
                        teamsFeedback.ok
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "border-destructive/30 bg-destructive/10 text-destructive",
                      )}
                    >
                      {teamsFeedback.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>{teamsFeedback.message}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      Automated Alerts Sent to Teams
                    </h4>
                  </div>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        <strong className="text-foreground">Team Logins &amp; Logouts:</strong>{" "}
                        Instant alerts when team members punch in or out.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        <strong className="text-foreground">Daily EOD Digest:</strong> Consolidated
                        team EOD report posted after the last logout of the day.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        <strong className="text-foreground">Leave Requests:</strong> Alerts when
                        team members apply for leave or receive approval/rejection.
                      </span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                <div className="flex items-center gap-2">
                  {isTeamsConfigured && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          {teamsDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Remove Teams Integration
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove Microsoft Teams integration?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This deletes your encrypted Microsoft Teams webhook URL. Your saved SMTP
                            mail and WhatsApp configurations will stay intact.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => void handleDeleteTeams()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Remove Teams
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void handleTestTeams()}
                    className="gap-1.5"
                  >
                    {teamsTesting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    {teamsTesting ? "Sending..." : "Send Test Teams Message"}
                  </Button>
                  <Button type="submit" disabled={busy} className="gap-1.5">
                    {teamsSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5" />
                    )}
                    {teamsSaving ? "Saving..." : "Save Teams Settings"}
                  </Button>
                </div>
              </div>
            </form>
          ) : isWhatsAppMode ? (
            /* WhatsApp Integration Form */
            <form className="space-y-6" onSubmit={handleSaveWhatsApp}>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  WhatsApp Connection Method
                </Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setWhatsappMode("cloud_api");
                      setWhatsappFeedback(null);
                    }}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-colors cursor-pointer",
                      whatsappMode === "cloud_api"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-foreground hover:bg-muted/50",
                    )}
                  >
                    Meta WhatsApp Cloud API
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setWhatsappMode("webhook");
                      setWhatsappFeedback(null);
                    }}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-colors cursor-pointer",
                      whatsappMode === "webhook"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-foreground hover:bg-muted/50",
                    )}
                  >
                    Custom WhatsApp Webhook URL
                  </button>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
                    <MessageCircle className="h-4 w-4 text-primary" />
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      {whatsappMode === "cloud_api"
                        ? "Meta Cloud API Credentials"
                        : "WhatsApp Webhook Endpoint"}
                    </h4>
                  </div>

                  {whatsappMode === "cloud_api" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="whatsapp-phone-number-id" className="text-xs">
                          Phone Number ID <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="whatsapp-phone-number-id"
                          value={whatsappPhoneNumberId}
                          onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                          placeholder="e.g. 104298374615290"
                          className="font-mono tabular-nums"
                          disabled={busy}
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="whatsapp-access-token" className="text-xs">
                          Permanent / System Access Token{" "}
                          {(!config?.hasWhatsAppConfig || config?.whatsappMode !== "cloud_api") && (
                            <span className="text-destructive">*</span>
                          )}
                        </Label>
                        <div className="relative">
                          <Input
                            id="whatsapp-access-token"
                            type={showWhatsAppSecret ? "text" : "password"}
                            value={whatsappAccessToken}
                            onChange={(e) => setWhatsappAccessToken(e.target.value)}
                            placeholder={
                              config?.hasWhatsAppConfig && config?.whatsappMode === "cloud_api"
                                ? "•••••••• (leave blank to keep saved)"
                                : "EAAG..."
                            }
                            autoComplete="off"
                            className="pr-10"
                            disabled={busy}
                          />
                          <button
                            type="button"
                            onClick={() => setShowWhatsAppSecret((prev) => !prev)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                            aria-label={
                              showWhatsAppSecret
                                ? "Hide WhatsApp access token"
                                : "Show WhatsApp access token"
                            }
                          >
                            {showWhatsAppSecret ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {config?.hasWhatsAppConfig && config?.whatsappMode === "cloud_api"
                            ? "Your Access Token is encrypted on the server. Leave blank to keep it unchanged."
                            : "Copy your WhatsApp Business Cloud API token from Meta for Developers."}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="whatsapp-recipient-phone" className="text-xs">
                          Recipient WhatsApp Number <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="whatsapp-recipient-phone"
                          value={whatsappRecipientPhone}
                          onChange={(e) => setWhatsappRecipientPhone(e.target.value)}
                          placeholder="+919876543210"
                          className="font-mono tabular-nums"
                          disabled={busy}
                          required
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Include the country code (e.g. +91 for India or +1 for US).
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="whatsapp-webhook-url" className="text-xs">
                          WhatsApp Webhook URL{" "}
                          {(!config?.hasWhatsAppConfig || config?.whatsappMode !== "webhook") && (
                            <span className="text-destructive">*</span>
                          )}
                        </Label>
                        <div className="relative">
                          <Input
                            id="whatsapp-webhook-url"
                            type={showWhatsAppSecret ? "text" : "password"}
                            value={whatsappWebhookUrl}
                            onChange={(e) => setWhatsappWebhookUrl(e.target.value)}
                            placeholder={
                              config?.hasWhatsAppConfig && config?.whatsappMode === "webhook"
                                ? "https://•••••••• (leave blank to keep saved)"
                                : "https://your-gateway.example.com/whatsapp-webhook"
                            }
                            autoComplete="off"
                            className="pr-10"
                            disabled={busy}
                          />
                          <button
                            type="button"
                            onClick={() => setShowWhatsAppSecret((prev) => !prev)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                            aria-label={
                              showWhatsAppSecret
                                ? "Hide WhatsApp webhook URL"
                                : "Show WhatsApp webhook URL"
                            }
                          >
                            {showWhatsAppSecret ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {config?.hasWhatsAppConfig && config?.whatsappMode === "webhook"
                            ? "Your WhatsApp webhook URL is encrypted on the server. Leave blank to keep it unchanged."
                            : "Provide an HTTPS endpoint (e.g. Make, Zapier, n8n, or Twilio bridge) accepting JSON alert payloads."}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="whatsapp-webhook-recipient" className="text-xs">
                          Target WhatsApp Number (optional)
                        </Label>
                        <Input
                          id="whatsapp-webhook-recipient"
                          value={whatsappRecipientPhone}
                          onChange={(e) => setWhatsappRecipientPhone(e.target.value)}
                          placeholder="+919876543210"
                          className="font-mono tabular-nums"
                          disabled={busy}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Passed as <code className="font-mono">to</code> in the webhook JSON
                          payload if your workflow routes to a specific number or group.
                        </p>
                      </div>
                    </>
                  )}

                  {whatsappFeedback && (
                    <div
                      className={cn(
                        "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
                        whatsappFeedback.ok
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "border-destructive/30 bg-destructive/10 text-destructive",
                      )}
                    >
                      {whatsappFeedback.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>{whatsappFeedback.message}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      Automated Alerts Sent to WhatsApp
                    </h4>
                  </div>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        <strong className="text-foreground">Team Logins &amp; Logouts:</strong>{" "}
                        Instant WhatsApp alerts when team members punch in or out.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        <strong className="text-foreground">Daily EOD Digest:</strong> Consolidated
                        team EOD report delivered after the last logout of the day.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        <strong className="text-foreground">Leave Requests:</strong> Real-time
                        WhatsApp alerts when team members submit, approve, or reject leave.
                      </span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                <div className="flex items-center gap-2">
                  {isWhatsAppConfigured && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          {whatsappDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Remove WhatsApp Integration
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove WhatsApp integration?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This deletes your encrypted WhatsApp credentials. Your saved SMTP mail
                            and Microsoft Teams configurations will stay intact.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => void handleDeleteWhatsApp()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Remove WhatsApp
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void handleTestWhatsApp()}
                    className="gap-1.5"
                  >
                    {whatsappTesting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    {whatsappTesting ? "Sending..." : "Send Test WhatsApp Message"}
                  </Button>
                  <Button type="submit" disabled={busy} className="gap-1.5">
                    {whatsappSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MessageCircle className="h-3.5 w-3.5" />
                    )}
                    {whatsappSaving ? "Saving..." : "Save WhatsApp Settings"}
                  </Button>
                </div>
              </div>
            </form>
          ) : (
            /* Main SMTP Form */
            <form className="space-y-6" onSubmit={handleSave}>
              <div className="grid gap-5 lg:grid-cols-2">
                {/* Server & Credentials */}
                <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
                    <Server className="h-4 w-4 text-primary" />
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      SMTP Server &amp; Credentials
                    </h4>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-host" className="text-xs">
                      SMTP Host <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="smtp-host"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder={
                        selectedPresetId === "outlook" ? "smtp-mail.outlook.com" : "smtp.gmail.com"
                      }
                      disabled={busy}
                      required
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp-port" className="text-xs">
                        Port <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="smtp-port"
                        type="number"
                        min={1}
                        max={65535}
                        className="font-mono tabular-nums"
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                        disabled={busy}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp-encryption" className="text-xs">
                        Encryption
                      </Label>
                      <Select
                        value={encryption}
                        onValueChange={(v) => handleEncryptionChange(v as SmtpEncryptionMode)}
                        disabled={busy}
                      >
                        <SelectTrigger id="smtp-encryption" className="w-full">
                          <SelectValue placeholder="Select encryption" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="starttls">STARTTLS (587)</SelectItem>
                          <SelectItem value="ssl_tls">SSL / TLS (465)</SelectItem>
                          <SelectItem value="none">None (25)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-username" className="text-xs">
                      SMTP Username <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="smtp-username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="you@company.com"
                      autoComplete="username"
                      disabled={busy}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-password" className="text-xs">
                      SMTP Password / App Password{" "}
                      {!config?.hasPassword && <span className="text-destructive">*</span>}
                    </Label>
                    <div className="relative">
                      <Input
                        id="smtp-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={
                          config?.hasPassword
                            ? "•••••••• (leave blank to keep saved)"
                            : "Enter SMTP password or app password"
                        }
                        autoComplete="new-password"
                        className="pr-10"
                        disabled={busy}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        aria-label={showPassword ? "Hide SMTP password" : "Show SMTP password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {config?.hasPassword
                        ? "A password is already encrypted and saved. Leave blank to keep it unchanged."
                        : "Stored encrypted on the server and never sent back to the browser."}
                    </p>
                  </div>
                </div>

                {/* Sender Identity */}
                <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
                    <Mail className="h-4 w-4 text-primary" />
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      Sender Identity
                    </h4>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-from-name" className="text-xs">
                      From Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="smtp-from-name"
                      value={fromName}
                      onChange={(e) => setFromName(e.target.value)}
                      placeholder="Alex Morgan"
                      disabled={busy}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-from-email" className="text-xs">
                      From Email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="smtp-from-email"
                      type="email"
                      value={fromEmail}
                      onChange={(e) => setFromEmail(e.target.value)}
                      placeholder="alex@company.com"
                      disabled={busy}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-reply-to" className="text-xs">
                      Reply-To Email (optional)
                    </Label>
                    <Input
                      id="smtp-reply-to"
                      type="email"
                      value={replyTo}
                      onChange={(e) => setReplyTo(e.target.value)}
                      placeholder="Leave blank to use From Email"
                      disabled={busy}
                    />
                  </div>

                  {/* Connection Test & Test Email Box */}
                  <div className="space-y-3 rounded-xl border border-border bg-card p-3.5">
                    <p className="text-xs font-semibold text-foreground">
                      Test &amp; Verify Mail Delivery
                    </p>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="smtp-test-recipient"
                        className="text-[11px] text-muted-foreground"
                      >
                        Test Email Recipient
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        <Input
                          id="smtp-test-recipient"
                          type="email"
                          value={testRecipient}
                          onChange={(e) => setTestRecipient(e.target.value)}
                          placeholder={me?.email || "recipient@example.com"}
                          className="h-9 flex-1 min-w-[180px]"
                          disabled={busy}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void handleTest("send_test")}
                          className="h-9 gap-1.5 shrink-0"
                        >
                          {testingMode === "send_test" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          {testingMode === "send_test" ? "Sending..." : "Send Test Mail"}
                        </Button>
                      </div>
                    </div>

                    {testFeedback && (
                      <div
                        className={cn(
                          "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
                          testFeedback.ok
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "border-destructive/30 bg-destructive/10 text-destructive",
                        )}
                      >
                        {testFeedback.ok ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>{testFeedback.message}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer Action Row */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                <div className="flex items-center gap-2">
                  {isConfigured && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          {deleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Remove Integration
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove personal SMTP integration?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes your saved SMTP server settings and encrypted
                            mail credentials for your account. Other team members&apos; integrations
                            are unaffected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => void handleDelete()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Remove SMTP
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void handleTest("verify")}
                    className="gap-1.5"
                  >
                    {testingMode === "verify" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    {testingMode === "verify" ? "Verifying..." : "Verify Connection"}
                  </Button>
                  <Button type="submit" disabled={busy} className="gap-1.5">
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Mail className="h-3.5 w-3.5" />
                    )}
                    {saving ? "Saving..." : "Save SMTP Settings"}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
