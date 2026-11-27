import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Clock,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState, Initials, PageHeader, roleLabel } from "@/components/app-shell";
import { PirateEmblemIcon } from "@/components/battalion-nav-item";
import { PresenceSetupModal } from "@/components/presence-setup-modal";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BATTALION_STATUS_FILTERS,
  formatRemainingTime,
  getPresenceStatusTone,
  isPresenceExpired,
} from "@/lib/battalion";
import { createBattalion, deleteBattalion, getBattalions } from "@/lib/battalion.functions";
import { useApp } from "@/lib/store";
import type { BattalionMember, PopulatedBattalion } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/battalion")({
  head: () => ({
    meta: [
      { title: "Battalion — Live Squad Visibility | SACE Workpulse" },
      {
        name: "description",
        content:
          "View Battalion squads, live teammate statuses, availability windows, and active collaboration readiness.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <BattalionPage />
    </AppShell>
  ),
});

function BattalionPage() {
  const { me, ready, myPresence, canEditModule } = useApp();
  const isAdminOrSuper = me?.role === "admin" || me?.role === "super_admin";
  const canEditBattalion = canEditModule("battalion");

  const [battalions, setBattalions] = React.useState<PopulatedBattalion[]>([]);
  const [directoryMembers, setDirectoryMembers] = React.useState<BattalionMember[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  const [createOpen, setCreateOpen] = React.useState(false);
  const [statusModalOpen, setStatusModalOpen] = React.useState(false);

  const loadBattalions = React.useCallback(
    async (silent = false) => {
      if (!ready || !me) return;
      if (!silent) setRefreshing(true);
      try {
        const res = await getBattalions();
        if (res && Array.isArray(res.battalions)) {
          setBattalions(res.battalions);
        }
        if (res && Array.isArray(res.members)) {
          setDirectoryMembers(res.members);
        }
      } catch (err) {
        if (!silent) {
          toast.error(err instanceof Error ? err.message : "Failed to load Battalion squads.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [ready, me],
  );

  // Initial fetch + 20-second polling interval once authenticated session is ready
  React.useEffect(() => {
    if (!ready || !me) return;
    void loadBattalions(true);
    const pollTimer = window.setInterval(() => {
      void loadBattalions(true);
    }, 20_000);
    return () => window.clearInterval(pollTimer);
  }, [ready, me, loadBattalions]);

  // Live 1-second ticker so countdowns & expirations stay accurate without cron jobs
  React.useEffect(() => {
    const tickTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(tickTimer);
  }, []);

  // Immediately patch the signed-in user's live presence across squad views after self-update
  const effectiveBattalions = React.useMemo(() => {
    const safeBattalions = Array.isArray(battalions) ? battalions : [];
    if (!me || !myPresence) return safeBattalions;
    return safeBattalions.map((squad) => ({
      ...squad,
      members: (Array.isArray(squad.members) ? squad.members : []).map((member) =>
        member.id === me.id ? { ...member, presence: myPresence } : member,
      ),
    }));
  }, [battalions, me, myPresence]);

  const effectiveDirectory = React.useMemo(() => {
    const safeDirectory = Array.isArray(directoryMembers) ? directoryMembers : [];
    if (!me || !myPresence) return safeDirectory;
    return safeDirectory.map((member) =>
      member.id === me.id ? { ...member, presence: myPresence } : member,
    );
  }, [directoryMembers, me, myPresence]);

  const filteredBattalions = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return effectiveBattalions
      .map((squad) => {
        const squadMembers = Array.isArray(squad.members) ? squad.members : [];
        const squadNameMatches =
          query.length > 0 &&
          (squad.name.toLowerCase().includes(query) ||
            (squad.description ?? "").toLowerCase().includes(query));

        const filteredMembers = squadMembers.filter((member) => {
          const presence = member.presence;
          const expired = isPresenceExpired(presence, nowMs);
          const effectiveStatus = presence && !expired ? presence.status : "Offline / Expired";

          const matchesStatus =
            statusFilter === "ALL" || (!expired && effectiveStatus === statusFilter);

          if (!matchesStatus) return false;
          if (!query || squadNameMatches) return true;

          return (
            member.fullName.toLowerCase().includes(query) ||
            member.designation.toLowerCase().includes(query) ||
            member.department.toLowerCase().includes(query) ||
            (presence?.availableFor ?? "").toLowerCase().includes(query) ||
            effectiveStatus.toLowerCase().includes(query)
          );
        });

        return {
          ...squad,
          visibleMembers: filteredMembers,
        };
      })
      .filter((squad) => {
        if (!query && statusFilter === "ALL") return true;
        if (
          statusFilter === "ALL" &&
          query &&
          (squad.name.toLowerCase().includes(query) ||
            squad.description.toLowerCase().includes(query))
        ) {
          return true;
        }
        return squad.visibleMembers.length > 0;
      });
  }, [effectiveBattalions, searchQuery, statusFilter, nowMs]);

  const metrics = React.useMemo(() => {
    const activeMembers = effectiveDirectory.filter(
      (m) => m.presence && !isPresenceExpired(m.presence, nowMs),
    );
    const openForTask = activeMembers.filter((m) => m.presence?.status === "Open for Task");
    return {
      squadCount: effectiveBattalions.length,
      liveCount: activeMembers.length,
      totalCount: effectiveDirectory.length,
      openForTaskCount: openForTask.length,
    };
  }, [effectiveBattalions.length, effectiveDirectory, nowMs]);

  const handleDeleteSquad = async (battalionId: string, name: string) => {
    try {
      await deleteBattalion({ data: { battalionId } });
      setBattalions((prev) => prev.filter((b) => b.id !== battalionId));
      toast.success(`Removed Battalion "${name}".`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove Battalion.");
    }
  };

  return (
    <>
      <PageHeader
        title="Battalion"
        description="Real-time squad roster, live work modes, and time-boxed availability windows."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canEditBattalion && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatusModalOpen(true)}
                className="gap-1.5"
              >
                <Radio className="h-3.5 w-3.5 text-[#8A007E] dark:text-purple-400" />
                My Live Status
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadBattalions(false)}
              disabled={refreshing}
              className="gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
            {isAdminOrSuper && canEditBattalion && (
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="gap-1.5 bg-gradient-to-r from-[#5B00A3] to-[#8A007E] text-white hover:opacity-95"
              >
                <Plus className="h-4 w-4" />
                Create Battalion / Team
              </Button>
            )}
          </div>
        }
      />

      {/* Summary Bar */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="rounded-xl border-border">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Active Battalions
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {metrics.squadCount}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5B00A3]/15 text-[#5B00A3] dark:text-purple-300">
              <PirateEmblemIcon className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-border">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Live Active Members
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {metrics.liveCount}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / {metrics.totalCount}
                </span>
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-border">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Open for Task
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {metrics.openForTaskCount}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
              <Sparkles className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search & Status Filter Toolbar */}
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search squads, members, or availability..."
            className="h-9 pl-9 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {BATTALION_STATUS_FILTERS.map((filterValue) => {
            const active = statusFilter === filterValue;
            return (
              <button
                key={filterValue}
                type="button"
                onClick={() => setStatusFilter(filterValue)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                  active
                    ? "border-[#5B00A3] bg-[#5B00A3] text-white"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {filterValue === "ALL" ? "All Statuses" : filterValue}
              </button>
            );
          })}
        </div>
      </div>

      {/* Squad Grid */}
      {loading ? (
        <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Battalion squads...
          </div>
        </div>
      ) : filteredBattalions.length === 0 ? (
        <EmptyState
          title={
            effectiveBattalions.length === 0
              ? "No Battalion squads created yet"
              : "No matching squad members found"
          }
          hint={
            effectiveBattalions.length === 0
              ? isAdminOrSuper
                ? "Create your first Battalion squad to coordinate live availability across teams."
                : "Admins can organize team members into Battalion squads here."
              : "Try clearing the search input or switching to All Statuses."
          }
          icon={Users}
          action={
            effectiveBattalions.length === 0 && isAdminOrSuper && canEditBattalion ? (
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="gap-1.5 bg-gradient-to-r from-[#5B00A3] to-[#8A007E] text-white"
              >
                <Plus className="h-4 w-4" />
                Create Battalion / Team
              </Button>
            ) : effectiveBattalions.length === 0 ? undefined : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("ALL");
                }}
              >
                Reset filters
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {filteredBattalions.map((squad) => {
            const activeInSquad = squad.members.filter(
              (m) => m.presence && !isPresenceExpired(m.presence, nowMs),
            ).length;

            return (
              <Card
                key={squad.id}
                className="flex flex-col overflow-hidden rounded-2xl border-border"
              >
                <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/35 px-5 py-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#2D0029] text-amber-300">
                        <PirateEmblemIcon className="h-4 w-4" />
                      </span>
                      <h2 className="truncate text-base font-bold text-foreground">{squad.name}</h2>
                    </div>
                    {squad.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {squad.description}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-semibold tabular-nums text-foreground">
                      {activeInSquad} / {squad.members.length} live
                    </span>

                    {isAdminOrSuper && canEditBattalion && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${squad.name}`}
                            title={`Delete ${squad.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Battalion "{squad.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes the squad grouping. Individual teammate accounts and live
                              presence statuses remain intact.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => void handleDeleteSquad(squad.id, squad.name)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete Squad
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>

                <CardContent className="divide-y divide-border p-0">
                  {squad.visibleMembers.map((member) => {
                    const presence = member.presence;
                    const expired = isPresenceExpired(presence, nowMs);
                    const hasPresence = Boolean(presence);
                    const statusText =
                      hasPresence && !expired
                        ? presence!.status
                        : hasPresence && expired
                          ? "Expired"
                          : "No status set";
                    const remainingText = hasPresence
                      ? formatRemainingTime(presence!.availableUntil, nowMs)
                      : "Unscheduled";
                    const statusTone = hasPresence
                      ? getPresenceStatusTone(presence!.status, expired)
                      : "border-border bg-muted/60 text-muted-foreground";

                    return (
                      <div
                        key={member.id}
                        className="flex flex-col gap-2.5 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Initials
                            name={member.fullName}
                            color={member.avatarColor}
                            src={member.avatarUrl}
                            size={36}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {member.fullName}
                              </p>
                              {me?.id === member.id && (
                                <span className="rounded bg-[#5B00A3]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#5B00A3] dark:text-purple-300">
                                  You
                                </span>
                              )}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {roleLabel(member.role)} · {member.designation}
                            </p>
                            {hasPresence && !expired && (
                              <p className="mt-0.5 truncate text-xs text-foreground/80">
                                Available for:{" "}
                                <span className="font-medium text-foreground">
                                  {presence!.availableFor}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold",
                              statusTone,
                            )}
                          >
                            {statusText}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium tabular-nums text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {remainingText}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {isAdminOrSuper && canEditBattalion && (
        <CreateBattalionDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          members={effectiveDirectory}
          onCreated={(created) => {
            setBattalions((prev) => [created, ...prev]);
          }}
        />
      )}

      {canEditBattalion && (
        <PresenceSetupModal
          open={statusModalOpen}
          onOpenChange={setStatusModalOpen}
          isMandatoryLoginPrompt={false}
        />
      )}
    </>
  );
}

function CreateBattalionDialog({
  open,
  onOpenChange,
  members,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: BattalionMember[];
  onCreated: (battalion: PopulatedBattalion) => void;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [memberSearch, setMemberSearch] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setMemberSearch("");
    setSelectedIds([]);
  }, [open]);

  const filteredMembers = React.useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.fullName.toLowerCase().includes(q) ||
        m.designation.toLowerCase().includes(q) ||
        m.department.toLowerCase().includes(q),
    );
  }, [members, memberSearch]);

  const toggleMember = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      toast.error("Please enter a Battalion name (at least 2 characters).");
      return;
    }
    if (selectedIds.length === 0) {
      toast.error("Please select at least one team member.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createBattalion({
        data: {
          name: trimmedName,
          description: description.trim(),
          memberIds: selectedIds,
        },
      });
      onCreated(res.battalion);
      toast.success(`Battalion "${res.battalion.name}" created.`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create Battalion.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl border-border bg-card p-0 shadow-xl">
        <div className="bg-gradient-to-r from-[#2D0029] via-[#5B00A3] to-[#8A007E] px-6 py-4 text-white">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-white">
              <PirateEmblemIcon className="h-5 w-5 text-amber-300" />
              Create Battalion / Team
            </DialogTitle>
            <DialogDescription className="text-xs text-purple-100/85">
              Group teammates into a cross-functional squad so everyone can track live presence and
              collaboration readiness.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="battalion-name" className="text-xs font-semibold">
              Squad Name
            </Label>
            <Input
              id="battalion-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Admissions Rapid Response Squad"
              maxLength={80}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="battalion-description" className="text-xs font-semibold">
              Mission / Description
            </Label>
            <Textarea
              id="battalion-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional scope, shift coverage, or focus area..."
              rows={2}
              maxLength={400}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">
                Select Squad Members ({selectedIds.length} selected)
              </Label>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedIds(members.map((m) => m.id))}
                  className="font-medium text-[#5B00A3] hover:underline dark:text-purple-300"
                >
                  Select all
                </button>
                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search teammates..."
                className="h-8 pl-8 text-xs"
              />
            </div>

            <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-background">
              {filteredMembers.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  No teammates match "{memberSearch}".
                </p>
              ) : (
                filteredMembers.map((member) => {
                  const checked = selectedIds.includes(member.id);
                  return (
                    <label
                      key={member.id}
                      className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleMember(member.id)}
                        />
                        <Initials
                          name={member.fullName}
                          color={member.avatarColor}
                          src={member.avatarUrl}
                          size={28}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {member.fullName}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {roleLabel(member.role)} · {member.designation}
                          </p>
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="gap-1.5 bg-gradient-to-r from-[#5B00A3] to-[#8A007E] text-white hover:opacity-95"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create Battalion
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
