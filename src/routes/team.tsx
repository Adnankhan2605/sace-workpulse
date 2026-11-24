import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import {
  AppShell,
  EmptyState,
  Initials,
  NoAccess,
  PageHeader,
  roleLabel,
} from "@/components/app-shell";
import { StatusPill } from "@/components/portal-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { PASSWORD_POLICY_ERROR, isStrongPassword } from "@/lib/security";
import { useApp } from "@/lib/store";
import type { Role } from "@/lib/types";

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Team & Accounts — SACE Portal" },
      {
        name: "description",
        content: "Create, edit and deactivate employee accounts and reporting lines.",
      },
      { property: "og:title", content: "Team & Accounts — SACE Portal" },
      {
        property: "og:description",
        content: "Manage employee accounts, roles and reporting structure.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <TeamPage />
    </AppShell>
  ),
});

function TeamPage() {
  const { state, me, can, createAccount, saveUser, deleteAccount, log, visibleUsers } = useApp();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createBusy, setCreateBusy] = React.useState(false);
  const [createForm, setCreateForm] = React.useState({
    fullName: "",
    email: "",
    password: "",
    designation: "",
    department: "",
    role: "member" as Role,
    reportingAdminId: "",
  });

  if (!can("manage_users")) return <NoAccess />;
  const people = visibleUsers();
  const canManageAdmins = can("manage_admins");
  const isSuperAdmin = me?.role === "super_admin";
  const admins = state.users.filter((u) => u.role !== "member");

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

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = createForm.email.trim().toLowerCase();
    if (!email) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (state.users.some((u) => u.email.toLowerCase() === email)) {
      toast.error("An account with that email already exists");
      return;
    }
    if (!isStrongPassword(createForm.password)) {
      toast.error(PASSWORD_POLICY_ERROR);
      return;
    }
    const assignedRole: Role = isSuperAdmin ? createForm.role : "member";
    const reportingAdminId =
      assignedRole === "member"
        ? isSuperAdmin
          ? createForm.reportingAdminId || null
          : (me?.id ?? null)
        : null;

    setCreateBusy(true);
    const res = await createAccount({
      fullName: createForm.fullName.trim(),
      email,
      password: createForm.password,
      designation: createForm.designation.trim() || roleLabel(assignedRole),
      department: createForm.department.trim() || "General",
      role: assignedRole,
      reportingAdminId,
      avatarColor: assignedRole === "member" ? "var(--brand-gold)" : "var(--brand-purple)",
    });
    setCreateBusy(false);

    if (!res.ok) {
      toast.error(res.error ?? "Could not create the account");
      return;
    }
    log("account_created", `${createForm.fullName.trim()} (${roleLabel(assignedRole)})`);
    toast.success(`${createForm.fullName.trim()} can now sign in with ${email}`);
    setCreateForm({
      fullName: "",
      email: "",
      password: "",
      designation: "",
      department: "",
      role: "member",
      reportingAdminId: "",
    });
    setCreateOpen(false);
  };

  return (
    <>
      <PageHeader
        title="Team & Accounts"
        description="Accounts are created by authorized administrators — there is no public sign-up."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus className="mr-1 h-4 w-4" /> New account
            </Button>
            {canManageAdmins && (
              <Button variant="outline" asChild>
                <Link to="/roles">Roles & Permissions</Link>
              </Button>
            )}
          </div>
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create team account</DialogTitle>
            <DialogDescription>
              Create a persistent account with email, password, department and designation.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateAccount}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="team-acc-name">Full name</Label>
                <Input
                  id="team-acc-name"
                  value={createForm.fullName}
                  onChange={(e) => setCreateForm((f) => ({ ...f, fullName: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-acc-email">Email</Label>
                <Input
                  id="team-acc-email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="team-acc-password">Password (min 12 chars)</Label>
                <Input
                  id="team-acc-password"
                  type="password"
                  autoComplete="new-password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Upper, lower, number & symbol"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-acc-designation">Designation</Label>
                <Input
                  id="team-acc-designation"
                  value={createForm.designation}
                  onChange={(e) => setCreateForm((f) => ({ ...f, designation: e.target.value }))}
                  placeholder="Team Member"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-acc-department">Department</Label>
                <Input
                  id="team-acc-department"
                  value={createForm.department}
                  onChange={(e) => setCreateForm((f) => ({ ...f, department: e.target.value }))}
                  placeholder="General"
                />
              </div>
              {isSuperAdmin && (
                <>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select
                      value={createForm.role}
                      onValueChange={(v) => setCreateForm((f) => ({ ...f, role: v as Role }))}
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
                  {createForm.role === "member" && admins.length > 0 && (
                    <div className="space-y-2">
                      <Label>Reporting admin</Label>
                      <Select
                        value={createForm.reportingAdminId}
                        onValueChange={(v) => setCreateForm((f) => ({ ...f, reportingAdminId: v }))}
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createBusy}>
                {createBusy ? "Creating…" : "Create account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {people.length === 0 ? (
        <EmptyState title="No accounts yet" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {people.map((u) => {
            const manager = state.users.find((x) => x.id === u.reportingAdminId);
            const editable = canManageAdmins || u.role === "member";
            const canDelete = isSuperAdmin && u.id !== me?.id && u.id !== "u-hakeem";
            return (
              <Card key={u.id} className="rounded-2xl">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <Initials
                        name={u.fullName}
                        color={u.avatarColor}
                        size={44}
                        src={u.avatarUrl ?? null}
                      />
                      <div>
                        <p className="font-semibold">{u.fullName}</p>
                        <p className="text-sm text-muted-foreground">
                          {u.designation} · {u.department}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          @{u.username} · {u.email}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Reports to {manager?.fullName ?? "—"} · CL {u.casualBalance} · SL{" "}
                          {u.sickBalance}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusPill
                        value={u.active ? "approved" : "closed"}
                        label={u.active ? "Active" : "Inactive"}
                      />
                      <span className="text-xs font-medium text-muted-foreground">
                        {roleLabel(u.role)}
                      </span>
                    </div>
                  </div>

                  {(editable && u.id !== me?.id) || canDelete ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                      <div className="flex flex-wrap items-center gap-3">
                        {editable && u.id !== me?.id && (
                          <>
                            <span className="flex items-center gap-2 text-sm">
                              <Switch
                                checked={u.active}
                                onCheckedChange={(v) =>
                                  void apply(
                                    { userId: u.id, active: v },
                                    `${u.fullName} ${v ? "activated" : "deactivated"}`,
                                    [
                                      "account_status",
                                      `${u.fullName} ${v ? "activated" : "deactivated"}`,
                                    ],
                                  )
                                }
                                aria-label="Account active"
                              />
                              Active
                            </span>
                            {canManageAdmins && (
                              <Select
                                value={u.role}
                                onValueChange={(v) =>
                                  void apply({ userId: u.id, role: v as Role }, "Role updated", [
                                    "role_change",
                                    `${u.fullName} → ${v}`,
                                  ])
                                }
                              >
                                <SelectTrigger className="w-44">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="member">Team Member</SelectItem>
                                  <SelectItem value="admin">Admin</SelectItem>
                                  <SelectItem value="super_admin">Super Admin</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </>
                        )}
                      </div>

                      {canDelete && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2.5"
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Delete account
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Account</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to permanently delete the account for{" "}
                                <span className="font-semibold text-foreground">{u.fullName}</span>?
                                This action cannot be undone and will permanently revoke portal
                                access.
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
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
