import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CalendarClock, Trash2, UserPlus } from "lucide-react";
import {
  AppShell,
  EmptyState,
  Initials,
  NoAccess,
  PageHeader,
  roleLabel,
} from "@/components/app-shell";
import { StatusPill } from "@/components/portal-ui";
import {
  CreateUserDialog,
  EditUserPolicyDialog,
  UserPolicyBadge,
  type EditablePolicyUser,
} from "@/components/user-account-dialogs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const {
    state,
    me,
    can,
    canViewModule,
    canEditModule,
    saveUser,
    deleteAccount,
    log,
    visibleUsers,
  } = useApp();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [policyUser, setPolicyUser] = React.useState<EditablePolicyUser | null>(null);

  if (!canViewModule("user_management")) return <NoAccess />;
  const people = visibleUsers();
  const canManageAdmins = can("manage_admins");
  const canEditUsers = canEditModule("user_management");
  const isSuperAdmin = me?.role === "super_admin";

  const apply = async (
    input: Parameters<typeof saveUser>[0],
    success: string,
    logLine: [string, string],
  ) => {
    if (!canEditUsers) return;
    const res = await saveUser(input);
    if (!res.ok) {
      toast.error(res.error ?? "Could not save the account");
      return;
    }
    log(logLine[0], logLine[1]);
    toast.success(success);
  };

  const handleDelete = async (userId: string, fullName: string) => {
    if (!canEditUsers) return;
    const res = await deleteAccount(userId);
    if (!res.ok) {
      toast.error(res.error ?? "Could not delete account");
      return;
    }
    toast.success(`${fullName}'s account has been permanently deleted.`);
  };

  return (
    <>
      <PageHeader
        title="Team & Accounts"
        description="Accounts are created by authorized administrators — there is no public sign-up."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canEditUsers && (
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus className="mr-1 h-4 w-4" /> New account
              </Button>
            )}
            {(canManageAdmins || canViewModule("user_management")) && (
              <Button variant="outline" asChild>
                <Link to="/roles">Roles & Permissions</Link>
              </Button>
            )}
          </div>
        }
      />

      {canEditUsers && <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {people.length === 0 ? (
        <EmptyState title="No accounts yet" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {people.map((u) => {
            const manager = state.users.find((x) => x.id === u.reportingAdminId);
            const editable = canEditUsers && (canManageAdmins || u.role === "member");
            const canEditPolicy =
              canEditUsers &&
              (isSuperAdmin ||
                (me?.role === "admin" &&
                  (can("manage_users") || can("approve_leave")) &&
                  u.role === "member"));
            const canDelete =
              canEditUsers &&
              u.id !== me?.id &&
              u.id !== "u-hakeem" &&
              u.id !== "u-superadmin" &&
              (isSuperAdmin ||
                (me?.role === "admin" &&
                  can("manage_users") &&
                  u.role === "member" &&
                  u.reportingAdminId === me.id));
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
                        <UserPolicyBadge user={u} className="mt-1.5" />
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

                  {(editable && u.id !== me?.id) || canEditPolicy || canDelete ? (
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

                      <div className="flex flex-wrap items-center gap-1.5">
                        {canEditPolicy && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPolicyUser(u)}
                            className="h-8 gap-1.5 px-2.5 text-xs"
                          >
                            <CalendarClock className="h-3.5 w-3.5 text-[#5B00A3]" />
                            Edit Schedule & Policy
                          </Button>
                        )}

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
                                  <span className="font-semibold text-foreground">
                                    {u.fullName}
                                  </span>
                                  ? This action cannot be undone and will permanently revoke portal
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
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {canEditUsers && (
        <EditUserPolicyDialog
          user={policyUser}
          open={Boolean(policyUser)}
          onOpenChange={(open) => {
            if (!open) setPolicyUser(null);
          }}
        />
      )}
    </>
  );
}
