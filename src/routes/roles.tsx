import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarClock,
  Check,
  Eye,
  Loader2,
  Lock,
  Pencil,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, Initials, PageHeader, roleLabel } from "@/components/app-shell";
import {
  CreateUserForm,
  EditUserPolicyDialog,
  UserPolicyBadge,
  type EditablePolicyUser,
} from "@/components/user-account-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DEFAULT_ADMIN_MODULE_PERMISSIONS,
  DEFAULT_MEMBER_MODULE_PERMISSIONS,
  PORTAL_MODULES,
  resolveEffectivePermissions,
  toggleModulePermissionField,
  type ModuleKey,
  type ModulePermission,
  type ModulePermissionsMap,
} from "@/lib/permissions";
import { getClientSessionToken } from "@/lib/portal-session-client";
import { PASSWORD_POLICY_ERROR, isStrongPassword } from "@/lib/security";
import { useApp, type Perm } from "@/lib/store";
import type { Role, User } from "@/lib/types";

export const Route = createFileRoute("/roles")({
  head: () => ({
    meta: [
      { title: "Roles & Permissions — SACE Portal" },
      {
        name: "description",
        content: "Create team accounts and control exactly what Admins can see in SACE Portal.",
      },
      { property: "og:title", content: "Roles & Permissions — SACE Portal" },
      {
        property: "og:description",
        content: "Super Admin control centre for accounts and admin visibility.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <RolesPage />
    </AppShell>
  ),
});

const ADMIN_CONTROLS: { perm: Perm; label: string; description: string }[] = [
  {
    perm: "manage_users",
    label: "Create & manage team accounts",
    description: "Add, edit and deactivate team member accounts",
  },
  {
    perm: "approve_leave",
    label: "Approve leave requests",
    description: "Approve or reject leave with a comment",
  },
  {
    perm: "view_all_eod",
    label: "View team EOD reports",
    description: "Daily, weekly, monthly and quarterly reports + PDF export",
  },
  {
    perm: "view_reports",
    label: "View progress reports",
    description: "Team-wide performance analytics",
  },
  {
    perm: "view_all_tickets",
    label: "View all support tickets",
    description: "Full helpdesk queue access",
  },
  {
    perm: "upload_leads",
    label: "Upload lead datasets",
    description: "Publish and lock lead data",
  },
  {
    perm: "manage_recognition",
    label: "Give recognition & awards",
    description: "Feature members on the leaderboard",
  },
  { perm: "system_settings", label: "Portal settings", description: "Portal-wide configuration" },
];

interface WorkspaceUserOption {
  id: string;
  fullName: string;
  email: string;
  role: "admin" | "member";
  designation: string;
  department: string;
  active: boolean;
}

interface PermissionsApiPayload {
  ok: boolean;
  error?: string;
  rolePermissions?: {
    admin: ModulePermissionsMap;
    member: ModulePermissionsMap;
  };
  userOverrides?: Record<string, Partial<Record<ModuleKey, ModulePermission>>>;
  users?: WorkspaceUserOption[];
  myPermissions?: ModulePermissionsMap;
}

function RolesPage() {
  const { me } = useApp();
  if (!me) return null;

  if (me.role !== "super_admin") {
    return (
      <>
        <PageHeader
          title="Roles & Permissions"
          description="View role permissions across Workpulse modules. Only Super Admin can modify these permissions."
        />
        <ModuleAccessMatrix />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Create team accounts and configure the Module Access Control Matrix for Admin and Team Member roles."
      />
      <Tabs defaultValue="matrix" className="space-y-6">
        <TabsList>
          <TabsTrigger value="matrix">Module Access Matrix</TabsTrigger>
          <TabsTrigger value="accounts">Team accounts</TabsTrigger>
          <TabsTrigger value="admin">Admin visibility</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix">
          <ModuleAccessMatrix />
        </TabsContent>
        <TabsContent value="accounts" className="space-y-6">
          <CreateAccount />
          <AccountList />
        </TabsContent>
        <TabsContent value="admin">
          <AdminVisibility />
        </TabsContent>
      </Tabs>
    </>
  );
}

function CreateAccount() {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4 text-primary" /> Create an account
        </CardTitle>
        <CardDescription>
          Set the email, password and role. Work schedule, leave quotas and attendance policy are
          optional — skip now and configure anytime later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CreateUserForm idPrefix="roles-acc" />
      </CardContent>
    </Card>
  );
}

function AccountList() {
  const { state, me, saveUser, deleteAccount, log } = useApp();
  const [resetTarget, setResetTarget] = React.useState<User | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = React.useState("");
  const [resetBusy, setResetBusy] = React.useState(false);
  const [policyTarget, setPolicyTarget] = React.useState<EditablePolicyUser | null>(null);
  const apply = async (
    input: Parameters<typeof saveUser>[0],
    success: string,
    logLine: [string, string],
  ) => {
    const res = await saveUser(input);
    if (!res.ok) {
      toast.error(res.error ?? "Could not save the account");
      return;
    }
    log(logLine[0], logLine[1]);
    toast.success(success);
  };

  const handleDelete = async (userId: string, fullName: string) => {
    const res = await deleteAccount(userId);
    if (!res.ok) {
      toast.error(res.error ?? "Could not delete account");
      return;
    }
    toast.success(`${fullName}'s account has been permanently deleted.`);
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">All accounts ({state.users.length})</CardTitle>
        <CardDescription>
          Change a role, reset a password, deactivate or delete an account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.users.map((u) => {
          const canDelete = me?.role === "super_admin" && u.id !== me.id && u.id !== "u-hakeem";
          return (
            <div
              key={u.id}
              className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <Initials name={u.fullName} color={u.avatarColor} />
                <div>
                  <p className="font-medium">
                    {u.fullName}
                    {u.id === me!.id && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                  <UserPolicyBadge user={u} className="mt-1" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!u.active && <Badge variant="secondary">Inactive</Badge>}
                <Select
                  value={u.role}
                  onValueChange={(v) =>
                    void apply(
                      { userId: u.id, role: v as Role },
                      `${u.fullName} is now ${roleLabel(v as Role)}`,
                      ["role_change", `${u.fullName} → ${v}`],
                    )
                  }
                  disabled={u.id === me!.id}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Team Member</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPolicyTarget(u)}
                  className="gap-1.5"
                >
                  <CalendarClock className="h-3.5 w-3.5 text-[#5B00A3]" />
                  Schedule & Policy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setResetTarget(u);
                    setResetPasswordValue("");
                  }}
                >
                  Reset password
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={u.id === me!.id}
                  onClick={() =>
                    void apply(
                      { userId: u.id, active: !u.active },
                      `${u.fullName} ${u.active ? "deactivated" : "activated"}`,
                      ["account_status", `${u.fullName} → ${u.active ? "inactive" : "active"}`],
                    )
                  }
                >
                  {u.active ? "Deactivate" : "Activate"}
                </Button>
                {canDelete && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive px-2"
                        title="Delete account"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Account</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to permanently delete the account for{" "}
                          <span className="font-semibold text-foreground">{u.fullName}</span>? This
                          action cannot be undone and will permanently revoke portal access.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => void handleDelete(u.id, u.fullName)}
                          className="bg-destructive hover:bg-destructive/90 text-white"
                        >
                          Delete Account
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>

      <Dialog
        open={!!resetTarget}
        onOpenChange={(open) => {
          if (!open) {
            setResetTarget(null);
            setResetPasswordValue("");
          }
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new strong password for {resetTarget?.fullName ?? "this user"}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!resetTarget) return;
              if (!isStrongPassword(resetPasswordValue)) {
                toast.error(PASSWORD_POLICY_ERROR);
                return;
              }
              setResetBusy(true);
              await apply(
                { userId: resetTarget.id, password: resetPasswordValue },
                "Password updated",
                ["password_reset", resetTarget.fullName],
              );
              setResetBusy(false);
              setResetTarget(null);
              setResetPasswordValue("");
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="reset-pwd-input">New strong password</Label>
              <Input
                id="reset-pwd-input"
                type="password"
                autoComplete="new-password"
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
                placeholder="Min 12 chars with upper, lower, digit & symbol"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={resetBusy}>
                {resetBusy ? "Updating…" : "Update Password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <EditUserPolicyDialog
        user={policyTarget}
        open={Boolean(policyTarget)}
        onOpenChange={(open) => {
          if (!open) setPolicyTarget(null);
        }}
      />
    </Card>
  );
}

function AdminVisibility() {
  const { adminPerms, setAdminPerms, log } = useApp();
  const toggle = (perm: Perm, on: boolean) => {
    const next = on ? [...adminPerms, perm] : adminPerms.filter((p) => p !== perm);
    setAdminPerms(next);
    log("admin_permission", `${perm} → ${on ? "allowed" : "hidden"}`);
  };
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" /> What Admins can see
        </CardTitle>
        <CardDescription>
          These switches apply to every Admin instantly. Hidden areas disappear from their
          navigation and pages.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ADMIN_CONTROLS.map((c) => (
          <div
            key={c.perm}
            className="flex items-center justify-between gap-4 rounded-xl border border-border p-4"
          >
            <div>
              <p className="font-medium">{c.label}</p>
              <p className="text-xs text-muted-foreground">{c.description}</p>
            </div>
            <Switch
              checked={adminPerms.includes(c.perm)}
              onCheckedChange={(on) => toggle(c.perm, on)}
              aria-label={c.label}
            />
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Managing admins, role changes and audit logs stay Super Admin only.
        </p>
      </CardContent>
    </Card>
  );
}

function ReadOnlyAccessBadges({ perm }: { perm: ModulePermission }) {
  if (!perm.view) {
    return (
      <span className="inline-flex items-center rounded-md border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
        No Access
      </span>
    );
  }
  if (perm.edit) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-semibold text-[#5B00A3]">
        <Check className="h-3 w-3" />
        View + Edit
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
      <Eye className="h-3 w-3" />
      View Only
    </span>
  );
}

function ModuleAccessMatrix() {
  const { me, refreshPermissions } = useApp();
  const isSuperAdmin = me?.role === "super_admin";

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [scope, setScope] = React.useState<string>("role");
  const [users, setUsers] = React.useState<WorkspaceUserOption[]>([]);

  const [savedRolePerms, setSavedRolePerms] = React.useState<{
    admin: ModulePermissionsMap;
    member: ModulePermissionsMap;
  }>({
    admin: DEFAULT_ADMIN_MODULE_PERMISSIONS,
    member: DEFAULT_MEMBER_MODULE_PERMISSIONS,
  });

  const [draftRolePerms, setDraftRolePerms] = React.useState<{
    admin: ModulePermissionsMap;
    member: ModulePermissionsMap;
  }>({
    admin: DEFAULT_ADMIN_MODULE_PERMISSIONS,
    member: DEFAULT_MEMBER_MODULE_PERMISSIONS,
  });

  const [userOverrides, setUserOverrides] = React.useState<
    Record<string, Partial<Record<ModuleKey, ModulePermission>>>
  >({});

  const [draftUserPerms, setDraftUserPerms] = React.useState<ModulePermissionsMap>(
    DEFAULT_MEMBER_MODULE_PERMISSIONS,
  );

  const hydrateFromPayload = React.useCallback((payload: PermissionsApiPayload) => {
    const nextAdmin = resolveEffectivePermissions("admin", payload.rolePermissions?.admin, null);
    const nextMember = resolveEffectivePermissions("member", payload.rolePermissions?.member, null);
    const nextRolePerms = { admin: nextAdmin, member: nextMember };
    setSavedRolePerms(nextRolePerms);
    setDraftRolePerms(nextRolePerms);
    setUserOverrides(payload.userOverrides ?? {});
    setUsers(payload.users ?? []);
    setDirty(false);
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const token = getClientSessionToken();
        const response = await fetch("/api/permissions", {
          method: "GET",
          credentials: "include",
          headers: {
            ...(token ? { "x-sace-session": token } : {}),
          },
        });
        const payload = (await response.json()) as PermissionsApiPayload;
        if (!alive) return;
        if (!response.ok || !payload.ok) {
          toast.error(payload.error ?? "Unable to load module permissions.");
        } else {
          hydrateFromPayload(payload);
        }
      } catch {
        if (alive) {
          toast.error("Unable to load module permissions right now.");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrateFromPayload]);

  const selectedUser = React.useMemo(
    () => (scope === "role" ? null : (users.find((u) => u.id === scope) ?? null)),
    [scope, users],
  );

  const selectedUserHasOverrides = Boolean(
    selectedUser &&
    userOverrides[selectedUser.id] &&
    Object.keys(userOverrides[selectedUser.id] ?? {}).length > 0,
  );

  const handleScopeChange = (nextScope: string) => {
    setScope(nextScope);
    setDirty(false);
    if (nextScope === "role") {
      setDraftRolePerms({
        admin: { ...savedRolePerms.admin },
        member: { ...savedRolePerms.member },
      });
      return;
    }
    const target = users.find((u) => u.id === nextScope);
    if (target) {
      const roleBase = savedRolePerms[target.role];
      const existingOverrides = userOverrides[target.id] ?? null;
      setDraftUserPerms(resolveEffectivePermissions(target.role, roleBase, existingOverrides));
    }
  };

  const handleToggleRolePerm = (
    roleKey: "admin" | "member",
    moduleKey: ModuleKey,
    field: "view" | "edit",
    checked: boolean,
  ) => {
    if (!isSuperAdmin) return;
    setDraftRolePerms((prev) => ({
      ...prev,
      [roleKey]: {
        ...prev[roleKey],
        [moduleKey]: toggleModulePermissionField(prev[roleKey][moduleKey], field, checked),
      },
    }));
    setDirty(true);
  };

  const handleToggleUserPerm = (moduleKey: ModuleKey, field: "view" | "edit", checked: boolean) => {
    if (!isSuperAdmin || !selectedUser) return;
    setDraftUserPerms((prev) => ({
      ...prev,
      [moduleKey]: toggleModulePermissionField(prev[moduleKey], field, checked),
    }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!isSuperAdmin || saving) return;
    setSaving(true);
    try {
      const token = getClientSessionToken();
      const body =
        scope === "role"
          ? {
              scope: "role" as const,
              rolePermissions: draftRolePerms,
            }
          : {
              scope: "user" as const,
              userId: scope,
              permissions: draftUserPerms,
            };

      const response = await fetch("/api/permissions", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-sace-session": token } : {}),
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as PermissionsApiPayload;
      if (!response.ok || !payload.ok) {
        toast.error(payload.error ?? "Failed to save module permissions.");
        return;
      }

      hydrateFromPayload(payload);
      if (scope !== "role") {
        const target = (payload.users ?? users).find((u) => u.id === scope);
        if (target && payload.rolePermissions) {
          setDraftUserPerms(
            resolveEffectivePermissions(
              target.role,
              payload.rolePermissions[target.role],
              payload.userOverrides?.[target.id] ?? null,
            ),
          );
        }
      }
      await refreshPermissions();
      toast.success(
        selectedUser
          ? `Saved custom permissions for ${selectedUser.fullName}`
          : "Role permissions saved across SACE Workpulse",
      );
    } catch {
      toast.error("Unable to save permissions. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetUserToDefault = async () => {
    if (!isSuperAdmin || !selectedUser || saving) return;
    setSaving(true);
    try {
      const token = getClientSessionToken();
      const response = await fetch("/api/permissions", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-sace-session": token } : {}),
        },
        body: JSON.stringify({
          scope: "user",
          userId: selectedUser.id,
          resetToDefault: true,
        }),
      });
      const payload = (await response.json()) as PermissionsApiPayload;
      if (!response.ok || !payload.ok) {
        toast.error(payload.error ?? "Could not reset user permissions.");
        return;
      }

      hydrateFromPayload(payload);
      if (payload.rolePermissions) {
        setDraftUserPerms(payload.rolePermissions[selectedUser.role]);
      }
      await refreshPermissions();
      toast.success(
        `${selectedUser.fullName} restored to ${roleLabel(selectedUser.role)} defaults`,
      );
    } catch {
      toast.error("Unable to reset permissions right now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="rounded-2xl border border-border bg-white shadow-xs">
      <CardHeader className="border-b border-border/70 pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <ShieldCheck className="h-5 w-5 text-[#5B00A3]" />
              Module Access Control Matrix
            </CardTitle>
            <CardDescription>
              Configure View and Edit permissions for all 15 Workpulse modules. Checking Edit
              automatically enables View; unchecking View revokes both.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {isSuperAdmin && (
              <div className="flex items-center gap-2">
                <Select value={scope} onValueChange={handleScopeChange}>
                  <SelectTrigger className="w-[260px] bg-white border-border">
                    <SelectValue placeholder="Scope: Default Role Permissions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="role">Scope: Default Role Permissions</SelectItem>
                    {users.map((u) => {
                      const hasOverride = Boolean(
                        userOverrides[u.id] && Object.keys(userOverrides[u.id] ?? {}).length > 0,
                      );
                      return (
                        <SelectItem key={u.id} value={u.id}>
                          {u.fullName} ({roleLabel(u.role)}){hasOverride ? " • Custom" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            {isSuperAdmin && selectedUser && selectedUserHasOverrides && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleResetUserToDefault()}
                disabled={saving}
                className="gap-1.5 border-border"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset to Role Default
              </Button>
            )}

            {isSuperAdmin && (
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || loading}
                className="gap-1.5 bg-[#5B00A3] hover:bg-[#490085] text-white shadow-xs"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? "Saving…" : dirty ? "Save Permissions*" : "Save Permissions"}
              </Button>
            )}
          </div>
        </div>

        {selectedUser && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-purple-200 bg-purple-50/70 px-3.5 py-2 text-xs text-[#5B00A3]">
            <span>
              Editing per-user overrides for{" "}
              <strong className="font-semibold">{selectedUser.fullName}</strong> (
              {roleLabel(selectedUser.role)}). Changes apply only to this user.
            </span>
            {selectedUserHasOverrides ? (
              <Badge className="bg-[#5B00A3] text-white hover:bg-[#5B00A3]">
                Custom Override Active
              </Badge>
            ) : (
              <Badge variant="outline" className="border-purple-300 text-[#5B00A3]">
                Using {roleLabel(selectedUser.role)} Default
              </Badge>
            )}
          </div>
        )}

        {!isSuperAdmin && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 text-[#5B00A3]" />
            <span>
              Read-only view: Only a Super Admin can modify role permissions or user overrides.
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent className="overflow-x-auto p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-[#5B00A3]" />
            Loading module permissions…
          </div>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3.5 w-[42%]">Module / Capability</th>
                <th className="px-4 py-3.5 text-center w-[18%]">Super Admin</th>
                <th className="px-4 py-3.5 text-center w-[20%]">
                  Admin
                  {selectedUser?.role === "admin" && (
                    <span className="ml-1.5 rounded bg-[#5B00A3]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#5B00A3] normal-case">
                      {selectedUser.fullName.split(" ")[0]}
                    </span>
                  )}
                </th>
                <th className="px-4 py-3.5 text-center w-[20%]">
                  Team Member
                  {selectedUser?.role === "member" && (
                    <span className="ml-1.5 rounded bg-[#5B00A3]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#5B00A3] normal-case">
                      {selectedUser.fullName.split(" ")[0]}
                    </span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {PORTAL_MODULES.map((mod) => {
                const adminPerm =
                  selectedUser?.role === "admin"
                    ? draftUserPerms[mod.key]
                    : draftRolePerms.admin[mod.key];
                const memberPerm =
                  selectedUser?.role === "member"
                    ? draftUserPerms[mod.key]
                    : draftRolePerms.member[mod.key];

                const adminMatchesRoleDefault =
                  selectedUser?.role === "admin" &&
                  adminPerm.view === savedRolePerms.admin[mod.key].view &&
                  adminPerm.edit === savedRolePerms.admin[mod.key].edit;
                const memberMatchesRoleDefault =
                  selectedUser?.role === "member" &&
                  memberPerm.view === savedRolePerms.member[mod.key].view &&
                  memberPerm.edit === savedRolePerms.member[mod.key].edit;

                const isCustomOverride =
                  (selectedUser?.role === "admin" && !adminMatchesRoleDefault) ||
                  (selectedUser?.role === "member" && !memberMatchesRoleDefault);

                const adminColumnEditable =
                  isSuperAdmin && (!selectedUser || selectedUser.role === "admin");
                const memberColumnEditable =
                  isSuperAdmin && (!selectedUser || selectedUser.role === "member");

                return (
                  <tr
                    key={mod.key}
                    className="border-t border-border/80 transition-colors hover:bg-muted/20"
                  >
                    <td className="px-5 py-3.5 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{mod.label}</p>
                        {isCustomOverride && (
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-[#5B00A3]">
                            Overridden
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{mod.description}</p>
                    </td>

                    {/* SUPER ADMIN LOCKED COLUMN */}
                    <td className="px-4 py-3.5 text-center align-middle">
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-semibold text-[#5B00A3]"
                        title="Super Admin always retains full View + Edit access"
                      >
                        <Lock className="h-3 w-3" />
                        View + Edit
                      </span>
                    </td>

                    {/* ADMIN COLUMN */}
                    <td className="px-4 py-3.5 text-center align-middle">
                      {!isSuperAdmin ? (
                        <ReadOnlyAccessBadges perm={adminPerm} />
                      ) : !adminColumnEditable ? (
                        <span className="text-xs text-muted-foreground/70">Role default</span>
                      ) : (
                        <div className="inline-flex items-center justify-center gap-4">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs font-medium text-foreground">
                            <Checkbox
                              checked={adminPerm.view}
                              onCheckedChange={(checked) => {
                                const val = checked === true;
                                if (selectedUser?.role === "admin") {
                                  handleToggleUserPerm(mod.key, "view", val);
                                } else {
                                  handleToggleRolePerm("admin", mod.key, "view", val);
                                }
                              }}
                              aria-label={`${mod.label} Admin View`}
                              className="border-[#5B00A3] data-[state=checked]:bg-[#5B00A3] data-[state=checked]:border-[#5B00A3] data-[state=checked]:text-white"
                            />
                            <span className="inline-flex items-center gap-1">
                              <Eye className="h-3 w-3 text-muted-foreground" />
                              View
                            </span>
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs font-medium text-foreground">
                            <Checkbox
                              checked={adminPerm.edit}
                              onCheckedChange={(checked) => {
                                const val = checked === true;
                                if (selectedUser?.role === "admin") {
                                  handleToggleUserPerm(mod.key, "edit", val);
                                } else {
                                  handleToggleRolePerm("admin", mod.key, "edit", val);
                                }
                              }}
                              aria-label={`${mod.label} Admin Edit`}
                              className="border-[#5B00A3] data-[state=checked]:bg-[#5B00A3] data-[state=checked]:border-[#5B00A3] data-[state=checked]:text-white"
                            />
                            <span className="inline-flex items-center gap-1">
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                              Edit
                            </span>
                          </label>
                        </div>
                      )}
                    </td>

                    {/* TEAM MEMBER COLUMN */}
                    <td className="px-4 py-3.5 text-center align-middle">
                      {!isSuperAdmin ? (
                        <ReadOnlyAccessBadges perm={memberPerm} />
                      ) : !memberColumnEditable ? (
                        <span className="text-xs text-muted-foreground/70">Role default</span>
                      ) : (
                        <div className="inline-flex items-center justify-center gap-4">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs font-medium text-foreground">
                            <Checkbox
                              checked={memberPerm.view}
                              onCheckedChange={(checked) => {
                                const val = checked === true;
                                if (selectedUser?.role === "member") {
                                  handleToggleUserPerm(mod.key, "view", val);
                                } else {
                                  handleToggleRolePerm("member", mod.key, "view", val);
                                }
                              }}
                              aria-label={`${mod.label} Team Member View`}
                              className="border-[#5B00A3] data-[state=checked]:bg-[#5B00A3] data-[state=checked]:border-[#5B00A3] data-[state=checked]:text-white"
                            />
                            <span className="inline-flex items-center gap-1">
                              <Eye className="h-3 w-3 text-muted-foreground" />
                              View
                            </span>
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs font-medium text-foreground">
                            <Checkbox
                              checked={memberPerm.edit}
                              onCheckedChange={(checked) => {
                                const val = checked === true;
                                if (selectedUser?.role === "member") {
                                  handleToggleUserPerm(mod.key, "edit", val);
                                } else {
                                  handleToggleRolePerm("member", mod.key, "edit", val);
                                }
                              }}
                              aria-label={`${mod.label} Team Member Edit`}
                              className="border-[#5B00A3] data-[state=checked]:bg-[#5B00A3] data-[state=checked]:border-[#5B00A3] data-[state=checked]:text-white"
                            />
                            <span className="inline-flex items-center gap-1">
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                              Edit
                            </span>
                          </label>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
