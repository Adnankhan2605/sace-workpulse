import * as React from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  RotateCcw,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { roleLabel } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { isUserScheduleConfigured } from "@/lib/accounts.schemas";
import { PASSWORD_POLICY_ERROR, isStrongPassword } from "@/lib/security";
import { useApp } from "@/lib/store";
import { WEEKDAYS, WORK_MODE_VALUES, type Role, type User, type WorkMode } from "@/lib/types";
import { cn } from "@/lib/utils";

const SHORT_DAY_LABEL: Record<string, string> = {
  Sunday: "Sun",
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
};

export interface SchedulePolicyDraft {
  shiftStartTime: string;
  shiftEndTime: string;
  weekOffs: string[];
  casualBalance: number;
  sickBalance: number;
  workMode: WorkMode;
  geoFenceMandatory: boolean;
}

const DEFAULT_SCHEDULE_POLICY_DRAFT: SchedulePolicyDraft = {
  shiftStartTime: "09:30",
  shiftEndTime: "18:30",
  weekOffs: ["Sunday"],
  casualBalance: 12,
  sickBalance: 12,
  workMode: "WFO",
  geoFenceMandatory: true,
};

export function UserPolicyBadge({
  user,
  className,
}: {
  user: Pick<
    User,
    "shiftStartTime" | "shiftEndTime" | "weekOffs" | "workMode" | "geoFenceMandatory"
  >;
  className?: string;
}) {
  const scheduleSet = isUserScheduleConfigured(user);
  const workMode: WorkMode = user.workMode ?? "WFO";
  const geoMandatory = user.geoFenceMandatory ?? true;

  if (!scheduleSet && workMode === "WFO" && geoMandatory) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap",
          className,
        )}
        title="Schedule & attendance policy skipped during creation — using safe system defaults (09:30–18:30, WFO, Geofence On)."
      >
        Default Policy
      </span>
    );
  }

  const timeRange =
    user.shiftStartTime || user.shiftEndTime
      ? `${user.shiftStartTime || "09:30"}–${user.shiftEndTime || "18:30"}`
      : "Default Shift";

  const weekOffSummary =
    Array.isArray(user.weekOffs) && user.weekOffs.length > 0
      ? `${user.weekOffs.map((d) => SHORT_DAY_LABEL[d] ?? d.slice(0, 3)).join(", ")} off`
      : "No week-off set";

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-1.5 rounded-md border border-[#5B00A3]/25 bg-[#5B00A3]/8 px-2 py-0.5 text-[11px] font-medium text-[#2D0029] dark:border-purple-400/30 dark:bg-purple-500/15 dark:text-purple-200 tabular-nums",
        className,
      )}
    >
      <span>{timeRange}</span>
      <span aria-hidden="true">·</span>
      <span>{weekOffSummary}</span>
      <span aria-hidden="true">·</span>
      <span>{workMode}</span>
      <span aria-hidden="true">·</span>
      <span>{geoMandatory ? "Geofence On" : "Geofence Off"}</span>
    </span>
  );
}

export function SchedulePolicyEditorFields({
  value,
  onChange,
  idPrefix = "policy",
}: {
  value: SchedulePolicyDraft;
  onChange: React.Dispatch<React.SetStateAction<SchedulePolicyDraft>>;
  idPrefix?: string;
}) {
  const toggleDay = (day: string) => {
    onChange((prev) => {
      const exists = prev.weekOffs.includes(day);
      return {
        ...prev,
        weekOffs: exists ? prev.weekOffs.filter((d) => d !== day) : [...prev.weekOffs, day],
      };
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-shift-start`} className="text-xs font-medium">
            Shift Login Time
          </Label>
          <Input
            id={`${idPrefix}-shift-start`}
            type="time"
            value={value.shiftStartTime}
            onChange={(e) => onChange((p) => ({ ...p, shiftStartTime: e.target.value }))}
            className="h-9 tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-shift-end`} className="text-xs font-medium">
            Shift Logout Time
          </Label>
          <Input
            id={`${idPrefix}-shift-end`}
            type="time"
            value={value.shiftEndTime}
            onChange={(e) => onChange((p) => ({ ...p, shiftEndTime: e.target.value }))}
            className="h-9 tabular-nums"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Week-Off Days</Label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((day) => {
            const active = value.weekOffs.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={active}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-[#5B00A3] bg-[#5B00A3] text-white"
                    : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {SHORT_DAY_LABEL[day]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-casual-bal`} className="text-xs font-medium">
            Casual Leave Quota (CL)
          </Label>
          <Input
            id={`${idPrefix}-casual-bal`}
            type="number"
            min={0}
            max={365}
            value={value.casualBalance}
            onChange={(e) =>
              onChange((p) => ({
                ...p,
                casualBalance: Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0))),
              }))
            }
            className="h-9 tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-sick-bal`} className="text-xs font-medium">
            Sick Leave Quota (SL)
          </Label>
          <Input
            id={`${idPrefix}-sick-bal`}
            type="number"
            min={0}
            max={365}
            value={value.sickBalance}
            onChange={(e) =>
              onChange((p) => ({
                ...p,
                sickBalance: Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0))),
              }))
            }
            className="h-9 tabular-nums"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Work Mode</Label>
          <div className="grid grid-cols-3 rounded-lg border border-border bg-muted/40 p-1">
            {WORK_MODE_VALUES.map((mode) => {
              const selected = value.workMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() =>
                    onChange((p) => ({
                      ...p,
                      workMode: mode,
                      geoFenceMandatory: mode === "WFH" ? false : p.geoFenceMandatory,
                    }))
                  }
                  aria-pressed={selected}
                  className={cn(
                    "rounded-md py-1.5 text-xs font-semibold transition-colors",
                    selected
                      ? "bg-[#5B00A3] text-white shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-[#8A007E]" />
              Mandatory Geofence
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {value.geoFenceMandatory ? "Require office GPS radius" : "Allow remote punch-in"}
            </p>
          </div>
          <Switch
            checked={value.geoFenceMandatory}
            onCheckedChange={(checked) => onChange((p) => ({ ...p, geoFenceMandatory: checked }))}
            aria-label="Mandatory Office Geofence Check-In"
          />
        </div>
      </div>
    </div>
  );
}

export function CreateUserForm({
  onCreated,
  onCancel,
  idPrefix = "create-user",
}: {
  onCreated?: (user?: User) => void;
  onCancel?: () => void;
  idPrefix?: string;
}) {
  const { state, me, createAccount, log } = useApp();
  const isSuperAdmin = me?.role === "super_admin";
  const admins = React.useMemo(
    () =>
      state.users.filter(
        (u) => u.role !== "member" && u.email.toLowerCase() !== "superadmin@sace.com",
      ),
    [state.users],
  );

  const [busyMode, setBusyMode] = React.useState<"skip" | "schedule" | null>(null);
  const [scheduleExpanded, setScheduleExpanded] = React.useState(false);

  const [core, setCore] = React.useState({
    fullName: "",
    email: "",
    password: "",
    designation: "",
    department: "",
    role: "member" as Role,
    reportingAdminId: "",
  });

  const [policy, setPolicy] = React.useState<SchedulePolicyDraft>(DEFAULT_SCHEDULE_POLICY_DRAFT);

  const submitAccount = async (skipSchedule: boolean) => {
    const fullName = core.fullName.trim();
    const email = core.email.trim().toLowerCase();

    if (fullName.length < 2) {
      toast.error("Please enter the employee's full name (at least 2 characters).");
      return;
    }
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (state.users.some((u) => u.email.toLowerCase() === email)) {
      toast.error("An account with that email already exists.");
      return;
    }
    if (!isStrongPassword(core.password)) {
      toast.error(PASSWORD_POLICY_ERROR);
      return;
    }

    const assignedRole: Role = isSuperAdmin ? core.role : "member";
    const reportingAdminId =
      assignedRole === "member"
        ? isSuperAdmin
          ? core.reportingAdminId || null
          : (me?.id ?? null)
        : null;

    setBusyMode(skipSchedule ? "skip" : "schedule");
    const res = await createAccount({
      fullName,
      email,
      password: core.password,
      designation: core.designation.trim() || roleLabel(assignedRole),
      department: core.department.trim() || "General",
      role: assignedRole,
      reportingAdminId,
      avatarColor: assignedRole === "member" ? "var(--brand-gold)" : "var(--brand-purple)",
      skipSchedule,
      ...(skipSchedule
        ? {}
        : {
            shiftStartTime: policy.shiftStartTime.trim() || null,
            shiftEndTime: policy.shiftEndTime.trim() || null,
            weekOffs: policy.weekOffs,
            casualBalance: policy.casualBalance,
            sickBalance: policy.sickBalance,
            workMode: policy.workMode,
            geoFenceMandatory: policy.geoFenceMandatory,
          }),
    });
    setBusyMode(null);

    if (!res.ok) {
      toast.error(res.error ?? "Could not create the account.");
      return;
    }

    log(
      "account_created",
      `${fullName} (${roleLabel(assignedRole)})${skipSchedule ? " · default policy" : " · custom schedule"}`,
    );
    toast.success(
      skipSchedule
        ? `${fullName} created with default attendance policy and can sign in immediately.`
        : `${fullName} created with custom schedule & policy and can sign in immediately.`,
    );

    setCore({
      fullName: "",
      email: "",
      password: "",
      designation: "",
      department: "",
      role: "member",
      reportingAdminId: "",
    });
    setPolicy(DEFAULT_SCHEDULE_POLICY_DRAFT);
    setScheduleExpanded(false);
    onCreated?.(res.user);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submitAccount(!scheduleExpanded);
      }}
    >
      {/* Core Identity Fields */}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-name`}>Full name *</Label>
          <Input
            id={`${idPrefix}-name`}
            value={core.fullName}
            onChange={(e) => setCore((f) => ({ ...f, fullName: e.target.value }))}
            placeholder="e.g. Ayesha Khan"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-email`}>Email *</Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            value={core.email}
            onChange={(e) => setCore((f) => ({ ...f, email: e.target.value }))}
            placeholder="name@sacegroup.com"
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-password`}>Password (min 12 chars) *</Label>
          <Input
            id={`${idPrefix}-password`}
            type="password"
            autoComplete="new-password"
            value={core.password}
            onChange={(e) => setCore((f) => ({ ...f, password: e.target.value }))}
            placeholder="Upper, lower, number & symbol"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-designation`}>Designation</Label>
          <Input
            id={`${idPrefix}-designation`}
            value={core.designation}
            onChange={(e) => setCore((f) => ({ ...f, designation: e.target.value }))}
            placeholder="Team Member"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-department`}>Department</Label>
          <Input
            id={`${idPrefix}-department`}
            value={core.department}
            onChange={(e) => setCore((f) => ({ ...f, department: e.target.value }))}
            placeholder="General"
          />
        </div>

        {isSuperAdmin && (
          <>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={core.role}
                onValueChange={(v) => setCore((f) => ({ ...f, role: v as Role }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Team Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {core.role === "member" && admins.length > 0 && (
              <div className="space-y-1.5">
                <Label>Reporting admin</Label>
                <Select
                  value={core.reportingAdminId}
                  onValueChange={(v) => setCore((f) => ({ ...f, reportingAdminId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an admin" />
                  </SelectTrigger>
                  <SelectContent>
                    {admins.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}
      </div>

      {/* Collapsible / Optional Work Schedule, Leaves & Attendance Policy */}
      <div className="overflow-hidden rounded-xl border border-border bg-muted/25">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => setScheduleExpanded((v) => !v)}
            className="flex flex-1 items-center gap-2 text-left min-w-0"
          >
            {scheduleExpanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-[#5B00A3]" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                Work Schedule, Leaves & Attendance Policy (Optional)
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {scheduleExpanded
                  ? "Custom shift times, week-offs, leave quotas, work mode & geofence"
                  : "Using safe defaults (CL 12, SL 12, WFO, Geofence On) · Configure anytime later"}
              </p>
            </div>
          </button>
          <Button
            type="button"
            variant={scheduleExpanded ? "ghost" : "outline"}
            size="sm"
            onClick={() => setScheduleExpanded((v) => !v)}
            className="h-8 shrink-0 text-xs"
          >
            {scheduleExpanded ? "Skip for Now" : "Add Schedule & Policy Details"}
          </Button>
        </div>

        {scheduleExpanded && (
          <div className="border-t border-border bg-card p-4">
            <SchedulePolicyEditorFields
              value={policy}
              onChange={setPolicy}
              idPrefix={`${idPrefix}-sched`}
            />
          </div>
        )}
      </div>

      {/* Dual Submission Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/60">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={busyMode !== null}
            className="mr-auto"
          >
            Cancel
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={busyMode !== null}
          onClick={() => void submitAccount(true)}
          className="gap-1.5"
        >
          {busyMode === "skip" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Create Account & Skip Schedule
        </Button>
        <Button
          type="button"
          disabled={busyMode !== null}
          onClick={() => void submitAccount(false)}
          className="gap-1.5 bg-[#5B00A3] text-white hover:bg-[#490083]"
        >
          {busyMode === "schedule" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserPlus className="h-3.5 w-3.5" />
          )}
          Create Account with Schedule
        </Button>
      </div>
    </form>
  );
}

export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (user?: User) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-[#5B00A3]" />
            Create Team Account
          </DialogTitle>
          <DialogDescription>
            Enter core credentials to onboard immediately. Work schedule, leave quotas, and
            attendance policy are optional and can be skipped or edited anytime later.
          </DialogDescription>
        </DialogHeader>
        <CreateUserForm
          idPrefix="modal-user"
          onCancel={() => onOpenChange(false)}
          onCreated={(u) => {
            onOpenChange(false);
            onCreated?.(u);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export type EditablePolicyUser = Pick<
  User,
  | "id"
  | "fullName"
  | "email"
  | "designation"
  | "department"
  | "casualBalance"
  | "sickBalance"
  | "shiftStartTime"
  | "shiftEndTime"
  | "weekOffs"
  | "workMode"
  | "geoFenceMandatory"
>;

export function EditUserPolicyDialog({
  user,
  open,
  onOpenChange,
  onSaved,
}: {
  user: EditablePolicyUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const { saveUser, log } = useApp();
  const [saving, setSaving] = React.useState(false);
  const [policy, setPolicy] = React.useState<SchedulePolicyDraft>(DEFAULT_SCHEDULE_POLICY_DRAFT);

  React.useEffect(() => {
    if (!user) return;
    setPolicy({
      shiftStartTime: user.shiftStartTime ?? "09:30",
      shiftEndTime: user.shiftEndTime ?? "18:30",
      weekOffs:
        Array.isArray(user.weekOffs) && user.weekOffs.length > 0 ? user.weekOffs : ["Sunday"],
      casualBalance: Number(user.casualBalance ?? 12),
      sickBalance: Number(user.sickBalance ?? 12),
      workMode: user.workMode ?? "WFO",
      geoFenceMandatory: user.geoFenceMandatory ?? true,
    });
  }, [user]);

  if (!user) return null;

  const isCurrentlyDefault = !isUserScheduleConfigured(user);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await saveUser({
      userId: user.id,
      shiftStartTime: policy.shiftStartTime.trim() || null,
      shiftEndTime: policy.shiftEndTime.trim() || null,
      weekOffs: policy.weekOffs,
      casualBalance: policy.casualBalance,
      sickBalance: policy.sickBalance,
      workMode: policy.workMode,
      geoFenceMandatory: policy.geoFenceMandatory,
    });
    setSaving(false);

    if (!res.ok) {
      toast.error(res.error ?? "Could not update schedule & policy.");
      return;
    }

    log(
      "policy_updated",
      `${user.fullName}: ${policy.shiftStartTime || "09:30"}–${policy.shiftEndTime || "18:30"}, ${policy.workMode}, Geofence ${policy.geoFenceMandatory ? "On" : "Off"}`,
    );
    toast.success(`Updated schedule & policy for ${user.fullName}.`);
    onOpenChange(false);
    onSaved?.();
  };

  const handleResetToDefault = async () => {
    setSaving(true);
    const res = await saveUser({
      userId: user.id,
      shiftStartTime: null,
      shiftEndTime: null,
      weekOffs: null,
      workMode: "WFO",
      geoFenceMandatory: true,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? "Could not reset policy.");
      return;
    }
    log("policy_reset", `${user.fullName}: Reset to Default Policy`);
    toast.success(`${user.fullName} set back to Default Policy.`);
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-[#5B00A3]" />
            Work Schedule & Policy · {user.fullName}
          </DialogTitle>
          <DialogDescription>
            {user.designation} · {user.department}
            {isCurrentlyDefault ? " · Currently using Default Policy" : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <SchedulePolicyEditorFields
            value={policy}
            onChange={setPolicy}
            idPrefix={`edit-policy-${user.id}`}
          />
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleResetToDefault()}
              disabled={saving}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to Default Policy
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="gap-1.5 bg-[#5B00A3] text-white hover:bg-[#490083]"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Save Policy
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
