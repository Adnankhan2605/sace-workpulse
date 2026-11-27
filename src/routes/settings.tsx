import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  ImagePlus,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Navigation,
  Palette,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  Users,
} from "lucide-react";
import { AppShell, Initials, PageHeader, roleLabel } from "@/components/app-shell";
import { PortalBrandingSettings } from "@/components/portal-branding-settings";
import { SmtpIntegrationSettings } from "@/components/smtp-integration-settings";
import { getClientSessionToken } from "@/lib/portal-session-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/store";
import {
  DEFAULT_OFFICE_GEOFENCE,
  formatShiftTime12h,
  getConfiguredOffices,
  requestCurrentPosition,
} from "@/lib/geofence";
import { PASSWORD_POLICY_ERROR, isStrongPassword, validateAndNormalizeImage } from "@/lib/security";
import type { OfficeLocation } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — SACE Portal" },
      {
        name: "description",
        content: "Update your SACE Portal profile, photo, daily vision and password.",
      },
      { property: "og:title", content: "Settings — SACE Portal" },
      { property: "og:description", content: "Personal profile and portal preferences." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});

/** Validate MIME/magic bytes/size and downscale avatar to a bounded WebP data URL. */
async function toAvatarDataUrl(file: File): Promise<string> {
  return validateAndNormalizeImage(file, { maxDim: 256, squareCrop: true, quality: 0.82 });
}

function SettingsPage() {
  const { state, me, can, canEditModule, saveUser, saveOfficeGeofence, log } = useApp();
  const canEditSettings = canEditModule("settings_integrations");
  const isAdmin = me?.role === "super_admin" || me?.role === "admin" || can("system_settings");
  const currentGeofence = state.officeGeofence ?? DEFAULT_OFFICE_GEOFENCE;

  const [fullName, setFullName] = React.useState(me?.fullName ?? "");
  const [email, setEmail] = React.useState(me?.email ?? "");
  const [designation, setDesignation] = React.useState(me?.designation ?? "");
  const [vision, setVision] = React.useState(me?.dailyVision ?? "");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const [geoEnabled, setGeoEnabled] = React.useState(currentGeofence.enabled);
  const [offices, setOffices] = React.useState<OfficeLocation[]>(() =>
    getConfiguredOffices(currentGeofence),
  );
  const [shiftStartTime, setShiftStartTime] = React.useState(
    currentGeofence.shiftStartTime ?? "09:30",
  );
  const [shiftEndTime, setShiftEndTime] = React.useState(currentGeofence.shiftEndTime ?? "18:30");
  const [lateCarryoverEnabled, setLateCarryoverEnabled] = React.useState(
    currentGeofence.lateCarryoverEnabled ?? true,
  );
  const [geoBusy, setGeoBusy] = React.useState(false);
  const [detectingOfficeId, setDetectingOfficeId] = React.useState<string | null>(null);

  const [dbHealth, setDbHealth] = React.useState<{
    connected: boolean;
    persistent: boolean;
    mode: "External PostgreSQL (Persistent)" | "Local/Ephemeral";
    sslEnabled: boolean;
    userCount: number;
    databaseHost: string | null;
    checkedAt: string;
    message: string;
  } | null>(null);
  const [dbHealthLoading, setDbHealthLoading] = React.useState(true);

  const refreshDbHealth = React.useCallback(async () => {
    setDbHealthLoading(true);
    try {
      const token = getClientSessionToken();
      const res = await fetch("/api/db/health", {
        method: "GET",
        credentials: "include",
        headers: {
          ...(token ? { "x-sace-session": token } : {}),
        },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          connected: boolean;
          persistent: boolean;
          mode: "External PostgreSQL (Persistent)" | "Local/Ephemeral";
          sslEnabled: boolean;
          userCount: number;
          databaseHost: string | null;
          checkedAt: string;
          message: string;
        };
        setDbHealth(data);
      }
    } catch {
      // Ignore network error
    } finally {
      setDbHealthLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshDbHealth();
  }, [refreshDbHealth, state.users.length]);

  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (me) {
      setFullName(me.fullName || "");
      setEmail(me.email || "");
      setDesignation(me.designation || "");
      setVision(me.dailyVision || "");
    }
  }, [me]);

  React.useEffect(() => {
    if (state.officeGeofence) {
      setGeoEnabled(state.officeGeofence.enabled);
      setOffices(getConfiguredOffices(state.officeGeofence));
      setShiftStartTime(state.officeGeofence.shiftStartTime ?? "09:30");
      setShiftEndTime(state.officeGeofence.shiftEndTime ?? "18:30");
      setLateCarryoverEnabled(state.officeGeofence.lateCarryoverEnabled ?? true);
    }
  }, [state.officeGeofence]);

  if (!me) {
    return null;
  }

  function updateOfficeField<K extends keyof OfficeLocation>(
    officeId: string,
    key: K,
    value: OfficeLocation[K],
  ) {
    setOffices((prev) => prev.map((o) => (o.id === officeId ? { ...o, [key]: value } : o)));
  }

  function handleAddOffice() {
    if (!canEditSettings) return;
    const newId = `office-${Date.now().toString(36)}`;
    const primary = offices[0] ?? DEFAULT_OFFICE_GEOFENCE;
    setOffices((prev) => [
      ...prev,
      {
        id: newId,
        name: `Branch Office ${prev.length + 1}`,
        latitude: primary.latitude,
        longitude: primary.longitude,
        radiusMeters: 150,
        enabled: true,
      },
    ]);
  }

  function handleRemoveOffice(officeId: string) {
    if (!canEditSettings) return;
    if (offices.length <= 1) {
      toast.error("At least one office location is required.");
      return;
    }
    setOffices((prev) => prev.filter((o) => o.id !== officeId));
  }

  async function detectCurrentOfficeGps(officeId: string) {
    if (!canEditSettings) return;
    setDetectingOfficeId(officeId);
    try {
      const coords = await requestCurrentPosition();
      setOffices((prev) =>
        prev.map((o) =>
          o.id === officeId ? { ...o, latitude: coords.latitude, longitude: coords.longitude } : o,
        ),
      );
      toast.success(
        `Captured GPS coordinates (${coords.latitude}, ${coords.longitude}) · ±${coords.accuracyMeters}m`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not capture current GPS location.");
    } finally {
      setDetectingOfficeId(null);
    }
  }

  async function handleSaveGeofence(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin || !canEditSettings) {
      toast.error("Edit permission is required to update office geofencing.");
      return;
    }

    if (offices.length === 0) {
      toast.error("Add at least one office location.");
      return;
    }

    for (const office of offices) {
      if (!office.name.trim()) {
        toast.error("Every office location must have a name.");
        return;
      }
      if (!Number.isFinite(office.latitude) || office.latitude < -90 || office.latitude > 90) {
        toast.error(`"${office.name}": Latitude must be between -90 and 90.`);
        return;
      }
      if (!Number.isFinite(office.longitude) || office.longitude < -180 || office.longitude > 180) {
        toast.error(`"${office.name}": Longitude must be between -180 and 180.`);
        return;
      }
      if (
        !Number.isFinite(office.radiusMeters) ||
        office.radiusMeters < 10 ||
        office.radiusMeters > 50000
      ) {
        toast.error(`"${office.name}": Allowed radius must be between 10m and 50,000m.`);
        return;
      }
    }

    if (!/^\d{1,2}:\d{2}$/.test(shiftStartTime) || !/^\d{1,2}:\d{2}$/.test(shiftEndTime)) {
      toast.error("Please select valid standard login and logout times.");
      return;
    }

    const sanitizedOffices = offices.map((o) => ({
      ...o,
      name: o.name.trim(),
      radiusMeters: Math.round(o.radiusMeters),
    }));
    const primary = sanitizedOffices[0]!;

    setGeoBusy(true);
    const res = await saveOfficeGeofence({
      enabled: geoEnabled,
      officeName: primary.name,
      latitude: primary.latitude,
      longitude: primary.longitude,
      radiusMeters: primary.radiusMeters,
      offices: sanitizedOffices,
      shiftStartTime,
      shiftEndTime,
      lateCarryoverEnabled,
    });
    setGeoBusy(false);

    if (!res.ok) {
      toast.error(res.error ?? "Failed to save office geofence configuration.");
      return;
    }
    toast.success("Multi-office geofencing & shift timing settings saved.");
  }

  async function pickAvatar(file: File | undefined) {
    if (!file || !me || !canEditSettings) return;
    setBusy(true);
    try {
      const avatarUrl = await toAvatarDataUrl(file);
      const res = await saveUser({ userId: me.id, avatarUrl });
      if (!res.ok) throw new Error(res.error ?? "Could not save the photo");
      log("avatar_updated", "Updated profile photo");
      toast.success("Profile photo updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the photo");
    } finally {
      setBusy(false);
    }
  }

  const profileAndSecurityContent = (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="rounded-2xl">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <Initials
              name={me.fullName}
              color={me.avatarColor}
              size={48}
              src={me.avatarUrl ?? null}
            />
            <div>
              <p className="font-semibold">{me.fullName}</p>
              <p className="text-sm text-muted-foreground">
                {roleLabel(me.role)} · @{me.username}
              </p>
            </div>
            {canEditSettings && (
              <div className="ml-auto">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => void pickAvatar(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus className="mr-1 h-4 w-4" /> Change photo
                </Button>
              </div>
            )}
          </div>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!me || !canEditSettings) return;
              setBusy(true);
              const res = await saveUser({
                userId: me.id,
                fullName: fullName.trim(),
                email: email.trim(),
                designation: designation.trim(),
                dailyVision: vision.trim() || null,
              });
              setBusy(false);
              if (!res.ok) {
                toast.error(res.error ?? "Could not save your profile");
                return;
              }
              log("profile_updated", "Updated own profile");
              toast.success("Profile saved");
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                value={fullName || ""}
                onChange={(e) => setFullName(e.target.value)}
                disabled={busy || !canEditSettings}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email || ""}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy || !canEditSettings}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="designation">Designation</Label>
              <Input
                id="designation"
                value={designation || ""}
                onChange={(e) => setDesignation(e.target.value)}
                disabled={busy || !canEditSettings}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vision">Daily vision</Label>
              <Textarea
                id="vision"
                value={vision || ""}
                onChange={(e) => setVision(e.target.value)}
                disabled={busy || !canEditSettings}
                rows={3}
              />
            </div>
            {canEditSettings && (
              <Button type="submit" disabled={busy}>
                Save profile
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="rounded-2xl">
          <CardContent className="space-y-4 p-5">
            <h3 className="font-semibold">Security &amp; Password</h3>
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!me || !canEditSettings) return;
                if (!isStrongPassword(password)) {
                  toast.error(PASSWORD_POLICY_ERROR);
                  return;
                }
                setBusy(true);
                const res = await saveUser({ userId: me.id, password });
                setBusy(false);
                if (!res.ok) {
                  toast.error(res.error ?? "Could not update the password");
                  return;
                }
                setPassword("");
                log("password_changed", "Changed own password");
                toast.success("Password updated");
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="pwd">New password</Label>
                <Input
                  id="pwd"
                  type="password"
                  value={password || ""}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  disabled={busy || !canEditSettings}
                />
              </div>
              {canEditSettings && (
                <Button type="submit" variant="outline" disabled={busy}>
                  Update password
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    dbHealth?.connected && dbHealth?.persistent
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-amber-500/10 text-amber-600",
                  )}
                >
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">
                    System Status &amp; Database Persistence
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Live verification of external PostgreSQL account storage
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={dbHealthLoading}
                onClick={() => void refreshDbHealth()}
                className="h-8 gap-1.5 text-xs"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", dbHealthLoading && "animate-spin")} />
                Check Now
              </Button>
            </div>

            <div
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border p-3.5",
                dbHealth?.connected && dbHealth?.persistent
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-amber-500/30 bg-amber-500/5",
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {dbHealth?.connected && dbHealth?.persistent ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {dbHealthLoading && !dbHealth
                      ? "Checking database connection..."
                      : (dbHealth?.mode ?? "Local/Ephemeral")}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {dbHealth?.databaseHost
                      ? `Host: ${dbHealth.databaseHost}`
                      : (dbHealth?.message ??
                        "Configure process.env.DATABASE_URL in Workspace Secrets.")}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                  dbHealth?.connected && dbHealth?.persistent
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700",
                )}
              >
                {dbHealth?.connected && dbHealth?.persistent ? "Persistent" : "Action Needed"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-muted/25 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <span>Persisted Accounts (`users`)</span>
                </div>
                <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
                  {dbHealthLoading && !dbHealth ? "—" : (dbHealth?.userCount ?? 0)}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-muted/25 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5 text-primary" />
                  <span>TLS / SSL Connection</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {dbHealth?.sslEnabled ? "SSL Enabled" : "Not Active"}
                </p>
              </div>
            </div>

            {dbHealth?.checkedAt && (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                Last verified {new Date(dbHealth.checkedAt).toLocaleTimeString()} · In-memory and
                local file fallbacks disabled.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const geofenceContent = isAdmin ? (
    <Card className="max-w-3xl rounded-2xl border-border">
      <CardContent className="space-y-5 p-5">
        <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MapPin className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Office Geofencing &amp; Shift Hours</h3>
              <p className="text-xs text-muted-foreground">
                Manage multiple office punch-in boundaries and standard shift login/logout times.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label htmlFor="geofence-toggle" className="text-xs text-muted-foreground">
              {geoEnabled ? "Active" : "Disabled"}
            </Label>
            <Switch
              id="geofence-toggle"
              checked={geoEnabled}
              onCheckedChange={setGeoEnabled}
              disabled={!canEditSettings || geoBusy}
            />
          </div>
        </div>

        <form className="space-y-5" onSubmit={handleSaveGeofence}>
          {/* Standard Shift Login & Logout Schedule */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/25 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  Standard Shift Timing
                </span>
              </div>
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                {formatShiftTime12h(shiftStartTime)} – {formatShiftTime12h(shiftEndTime)}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="shift-login-time" className="text-xs">
                  Standard Login Time
                </Label>
                <Input
                  id="shift-login-time"
                  type="time"
                  value={shiftStartTime}
                  onChange={(e) => setShiftStartTime(e.target.value)}
                  className="h-9 font-mono tabular-nums"
                  disabled={!canEditSettings || geoBusy}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shift-logout-time" className="text-xs">
                  Standard Logout Time
                </Label>
                <Input
                  id="shift-logout-time"
                  type="time"
                  value={shiftEndTime}
                  onChange={(e) => setShiftEndTime(e.target.value)}
                  className="h-9 font-mono tabular-nums"
                  disabled={!canEditSettings || geoBusy}
                  required
                />
              </div>
            </div>

            <div className="flex items-start justify-between gap-3 pt-1 border-t border-border/60">
              <div className="space-y-0.5">
                <Label htmlFor="late-carryover-toggle" className="text-xs font-semibold">
                  Carry forward late arrival to logout time
                </Label>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  If a teammate logs in late (e.g. +40 mins after{" "}
                  {formatShiftTime12h(shiftStartTime)}), they can only punch out after +40 mins past{" "}
                  {formatShiftTime12h(shiftEndTime)}.
                </p>
              </div>
              <Switch
                id="late-carryover-toggle"
                checked={lateCarryoverEnabled}
                onCheckedChange={setLateCarryoverEnabled}
                disabled={!canEditSettings || geoBusy}
              />
            </div>
          </div>

          {/* Multi-Office Locations */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  Office Locations ({offices.length})
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Employees can punch in from inside any enabled office boundary below.
                </p>
              </div>
              {canEditSettings && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddOffice}
                  className="h-8 gap-1 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Office
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {offices.map((office, idx) => (
                <div
                  key={office.id}
                  className="space-y-3 rounded-xl border border-border bg-card p-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {idx === 0 ? "Primary Office" : `Office Branch #${idx + 1}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                        <Switch
                          checked={office.enabled}
                          onCheckedChange={(v) => updateOfficeField(office.id, "enabled", v)}
                          disabled={!canEditSettings || geoBusy}
                        />
                        <span>{office.enabled ? "Enabled" : "Paused"}</span>
                      </label>
                      {canEditSettings && offices.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveOffice(office.id)}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Remove office"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`office-name-${office.id}`} className="text-xs">
                      Office location name
                    </Label>
                    <Input
                      id={`office-name-${office.id}`}
                      value={office.name}
                      onChange={(e) => updateOfficeField(office.id, "name", e.target.value)}
                      placeholder="e.g. SACE Group Headquarters"
                      disabled={!canEditSettings || geoBusy}
                      required
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`office-lat-${office.id}`} className="text-xs">
                        Latitude
                      </Label>
                      <Input
                        id={`office-lat-${office.id}`}
                        type="number"
                        step="any"
                        min={-90}
                        max={90}
                        className="h-9 font-mono tabular-nums"
                        value={office.latitude}
                        onChange={(e) =>
                          updateOfficeField(office.id, "latitude", Number(e.target.value))
                        }
                        disabled={!canEditSettings || geoBusy}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`office-lon-${office.id}`} className="text-xs">
                        Longitude
                      </Label>
                      <Input
                        id={`office-lon-${office.id}`}
                        type="number"
                        step="any"
                        min={-180}
                        max={180}
                        className="h-9 font-mono tabular-nums"
                        value={office.longitude}
                        onChange={(e) =>
                          updateOfficeField(office.id, "longitude", Number(e.target.value))
                        }
                        disabled={!canEditSettings || geoBusy}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={`office-radius-${office.id}`} className="text-xs">
                        Allowed Radius (meters)
                      </Label>
                      <div className="flex items-center gap-1">
                        {[50, 100, 250, 500].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            disabled={!canEditSettings || geoBusy}
                            onClick={() => updateOfficeField(office.id, "radiusMeters", preset)}
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                              Number(office.radiusMeters) === preset
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {preset}m
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`office-radius-${office.id}`}
                        type="number"
                        min={10}
                        max={50000}
                        step={5}
                        className="h-9 font-mono tabular-nums flex-1"
                        value={office.radiusMeters}
                        onChange={(e) =>
                          updateOfficeField(office.id, "radiusMeters", Number(e.target.value))
                        }
                        disabled={!canEditSettings || geoBusy}
                        required
                      />
                      {canEditSettings && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={detectingOfficeId === office.id || geoBusy}
                          onClick={() => void detectCurrentOfficeGps(office.id)}
                          className="h-9 gap-1.5 shrink-0"
                        >
                          {detectingOfficeId === office.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Navigation className="h-3.5 w-3.5" />
                          )}
                          {detectingOfficeId === office.id ? "Locating..." : "Use Current GPS"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {state.officeGeofence?.updatedAt ? (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                Last updated {new Date(state.officeGeofence.updatedAt).toLocaleString()}
              </p>
            ) : (
              <span />
            )}

            {canEditSettings && (
              <Button
                type="submit"
                disabled={geoBusy || Boolean(detectingOfficeId)}
                className="gap-1.5"
              >
                {geoBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {geoBusy ? "Saving..." : "Save Location & Shift Settings"}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  ) : null;

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          isAdmin
            ? "Manage your profile, personal mail integration, portal branding, and office geofencing preferences."
            : "Manage your profile, personal SMTP mail integration, and portal preferences."
        }
      />

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile" className="gap-1.5">
            <UserIcon className="h-3.5 w-3.5" />
            Profile &amp; Security
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            Integrations
          </TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="branding" className="gap-1.5">
                <Palette className="h-3.5 w-3.5" />
                Portal Branding
              </TabsTrigger>
              <TabsTrigger value="geofence" className="gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                Office &amp; Shift
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="profile">{profileAndSecurityContent}</TabsContent>
        <TabsContent value="integrations">
          <SmtpIntegrationSettings />
        </TabsContent>
        {isAdmin && (
          <>
            <TabsContent value="branding">
              <PortalBrandingSettings />
            </TabsContent>
            <TabsContent value="geofence">{geofenceContent}</TabsContent>
          </>
        )}
      </Tabs>
    </>
  );
}
