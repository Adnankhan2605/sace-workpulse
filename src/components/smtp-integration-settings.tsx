import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
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
  TestSmtpConfigSchema,
  TestTeamsConfigSchema,
  type PublicSmtpConfig,
  type SmtpEncryptionMode,
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

      if (!preserveSelectedPreset) {
        if (!cfg.configured && cfg.hasTeamsWebhook) {
          setSelectedPresetId("teams");
        } else {
          const matched = SMTP_PROVIDER_PRESETS.find(
            (p) => p.kind === "smtp" && p.label === cfg.providerLabel,
          );
          setSelectedPresetId(matched?.id ?? "custom");
        }
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

  const activePreset = React.useMemo(
    () => SMTP_PROVIDER_PRESETS.find((p) => p.id === selectedPresetId) ?? SMTP_PROVIDER_PRESETS[0],
    [selectedPresetId],
  );

  const isTeamsMode = activePreset?.kind === "teams";

  function selectPreset(presetId: string) {
    const preset = SMTP_PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPresetId(preset.id);
    setTestFeedback(null);
    setTeamsFeedback(null);
    if (preset.kind === "smtp") {
      setProviderLabel(preset.label);
      setPort(String(preset.port));
      setEncryption(preset.encryption);
      if (preset.host) {
        setHost(preset.host);
      }
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

  const busy =
    saving || testingMode !== null || deleting || teamsSaving || teamsTesting || teamsDeleting;

  if (loading) {
    return (
      <Card className="max-w-4xl rounded-2xl border-border">
        <CardContent className="flex items-center justify-center gap-2.5 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Loading your mail &amp; Teams integration settings...
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

  const activeStatusLabel = isTeamsMode ? teamsStatusLabel : smtpStatusLabel;
  const activeStatusState = isTeamsMode ? config?.teamsLastTestStatus : config?.lastTestStatus;
  const activeConfigured = isTeamsMode ? isTeamsConfigured : isConfigured;
  const activeLastVerifiedAt = isTeamsMode ? config?.teamsLastVerifiedAt : config?.lastVerifiedAt;

  return (
    <div className="max-w-4xl space-y-4">
      <Card className="rounded-2xl border-border">
        <CardContent className="space-y-6 p-5">
          {/* Header & Status Bar */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {isTeamsMode ? <MessageSquare className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-foreground">
                    {isTeamsMode
                      ? "Microsoft Teams Channel Integration"
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
                  {!isTeamsMode && isTeamsConfigured && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                      Teams {config?.teamsEnabled ? "Enabled" : "Paused"}
                    </span>
                  )}
                  {isTeamsMode && isConfigured && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      SMTP {config?.enabled ? "Enabled" : "Paused"}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {isTeamsMode
                    ? "Post team logins, logouts, daily EOD reports, and leave alerts into your Microsoft Teams channel using a secure webhook URL."
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
                htmlFor={isTeamsMode ? "teams-enabled-toggle" : "smtp-enabled-toggle"}
                className="text-xs text-muted-foreground"
              >
                {(isTeamsMode ? teamsEnabled : enabled) ? "Enabled" : "Disabled"}
              </Label>
              <Switch
                id={isTeamsMode ? "teams-enabled-toggle" : "smtp-enabled-toggle"}
                checked={isTeamsMode ? teamsEnabled : enabled}
                onCheckedChange={isTeamsMode ? setTeamsEnabled : setEnabled}
                disabled={busy}
              />
            </div>
          </div>

          {!isTeamsMode &&
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

          {/* Provider Presets */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mail Provider Preset
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SMTP_PROVIDER_PRESETS.map((preset) => {
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
                            mail configuration will stay intact.
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
