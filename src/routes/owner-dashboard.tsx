import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Edit3,
  FileText,
  Layers,
  Loader2,
  Mail,
  Plane,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  AppShell,
  EmptyState,
  Initials,
  NoAccess,
  PageHeader,
  roleLabel,
} from "@/components/app-shell";
import {
  EditUserPolicyDialog,
  UserPolicyBadge,
  type EditablePolicyUser,
} from "@/components/user-account-dialogs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate, fmtDateTime, fmtTime, titleCase } from "@/lib/format";
import {
  INITIATIVE_STATUS_LABELS,
  INITIATIVE_STATUS_VALUES,
  type InitiativeStatus,
  type OwnerAnalyticsResponse,
  type OwnerCompanyView,
  type OwnerEmployeeAnalytics,
  type OwnerInitiativeView,
  type OwnerTeamAnalytics,
  type OwnerTodayAttendanceState,
} from "@/lib/owner.schemas";
import { getClientSessionToken } from "@/lib/portal-session-client";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner-dashboard")({
  head: () => ({
    meta: [
      { title: "Owner's Dashboard — SACE Portal" },
      {
        name: "description",
        content:
          "Executive command view across companies, strategic initiatives, battalion squads, and employee analytics.",
      },
      { property: "og:title", content: "Owner's Dashboard — SACE Portal" },
      {
        property: "og:description",
        content: "Super Admin executive dashboard for SACE Workpulse.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <OwnerDashboardPage />
    </AppShell>
  ),
});

async function ownerApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
        `Server returned an unexpected error page (HTTP ${res.status}). Please refresh and sign in again.`,
      );
    }
    throw new Error(`Unexpected server response (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  }
  return data;
}

const NONE_OPTION = "__none__";

function InitiativeStatusBadge({ status }: { status: InitiativeStatus }) {
  const styles: Record<InitiativeStatus, string> = {
    on_track: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    at_risk: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    completed: "border-[#5B00A3]/30 bg-[#5B00A3]/10 text-[#5B00A3] dark:text-purple-300",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        styles[status],
      )}
    >
      {status === "on_track" ? (
        <CheckCircle2 className="h-3 w-3 shrink-0" />
      ) : status === "at_risk" ? (
        <AlertTriangle className="h-3 w-3 shrink-0" />
      ) : (
        <Target className="h-3 w-3 shrink-0" />
      )}
      {INITIATIVE_STATUS_LABELS[status]}
    </span>
  );
}

function TodayAttendanceBadge({ state }: { state: OwnerTodayAttendanceState }) {
  const map: Record<OwnerTodayAttendanceState, { label: string; cls: string }> = {
    checked_in: {
      label: "Checked In",
      cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    checked_out: {
      label: "Checked Out",
      cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    },
    on_leave: {
      label: "On Leave",
      cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    not_checked_in: {
      label: "Not Checked In",
      cls: "border-border bg-muted/60 text-muted-foreground",
    },
  };
  const cfg = map[state] ?? map.not_checked_in;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        cfg.cls,
      )}
    >
      {cfg.label}
    </span>
  );
}

function LivePresenceBadge({ status, expired }: { status: string | null; expired: boolean }) {
  if (!status || expired) {
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
        Offline
      </span>
    );
  }
  const s = status.trim();
  const cls =
    s === "On Desk"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : s === "Open for Task"
        ? "border-[#5B00A3]/30 bg-[#5B00A3]/10 text-[#5B00A3] dark:text-purple-300"
        : s === "In Meeting" || s === "In 1o1"
          ? "border-[#8A007E]/30 bg-[#8A007E]/10 text-[#8A007E] dark:text-fuchsia-300"
          : s === "Break"
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        cls,
      )}
    >
      {s}
    </span>
  );
}

function MiniProgressBar({
  value,
  tone = "brand",
}: {
  value: number;
  tone?: "brand" | "emerald" | "rose" | "amber";
}) {
  const safe = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const fillClass =
    tone === "emerald"
      ? "bg-emerald-600"
      : tone === "rose"
        ? "bg-rose-600"
        : tone === "amber"
          ? "bg-amber-500"
          : "bg-gradient-to-r from-[#5B00A3] to-[#8A007E]";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all duration-300", fillClass)}
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

function StatusDistributionBar({
  dist,
  total,
}: {
  dist: OwnerTeamAnalytics["statusDistribution"];
  total: number;
}) {
  const denom = Math.max(
    1,
    total ||
      dist.onDesk + dist.openForTask + dist.inMeeting + dist.onBreak + dist.other + dist.offline,
  );
  const segments = [
    { key: "onDesk", label: "On Desk", count: dist.onDesk, cls: "bg-emerald-500" },
    { key: "openForTask", label: "Open for Task", count: dist.openForTask, cls: "bg-[#5B00A3]" },
    { key: "inMeeting", label: "In Meeting", count: dist.inMeeting, cls: "bg-[#8A007E]" },
    { key: "onBreak", label: "Break", count: dist.onBreak, cls: "bg-amber-500" },
    { key: "other", label: "Other", count: dist.other, cls: "bg-sky-500" },
    {
      key: "offline",
      label: "Offline",
      count: dist.offline,
      cls: "bg-slate-300 dark:bg-slate-600",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((seg) =>
          seg.count > 0 ? (
            <div
              key={seg.key}
              className={cn("h-full transition-all duration-300", seg.cls)}
              style={{ width: `${(seg.count / denom) * 100}%` }}
              title={`${seg.label}: ${seg.count}`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
        {segments
          .filter((s) => s.count > 0)
          .map((seg) => (
            <span key={seg.key} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", seg.cls)} />
              <span>
                {seg.label}: <strong className="font-semibold text-foreground">{seg.count}</strong>
              </span>
            </span>
          ))}
      </div>
    </div>
  );
}

interface CompanyFormState {
  id: string | null;
  name: string;
  code: string;
  vertical: string;
  description: string;
  leadUserId: string;
  memberIds: string[];
  active: boolean;
}

const EMPTY_COMPANY_FORM: CompanyFormState = {
  id: null,
  name: "",
  code: "",
  vertical: "",
  description: "",
  leadUserId: NONE_OPTION,
  memberIds: [],
  active: true,
};

interface InitiativeFormState {
  id: string | null;
  title: string;
  description: string;
  companyId: string;
  battalionId: string;
  leadUserId: string;
  status: InitiativeStatus;
  progress: number;
  dueDate: string;
}

const EMPTY_INITIATIVE_FORM: InitiativeFormState = {
  id: null,
  title: "",
  description: "",
  companyId: NONE_OPTION,
  battalionId: NONE_OPTION,
  leadUserId: NONE_OPTION,
  status: "on_track",
  progress: 0,
  dueDate: "",
};

function OwnerDashboardPage() {
  const { me } = useApp();
  const [data, setData] = React.useState<OwnerAnalyticsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Company modal state
  const [companyModalOpen, setCompanyModalOpen] = React.useState(false);
  const [companyForm, setCompanyForm] = React.useState<CompanyFormState>(EMPTY_COMPANY_FORM);
  const [companyMemberFilter, setCompanyMemberFilter] = React.useState("");
  const [companySaving, setCompanySaving] = React.useState(false);

  // Initiative modal state
  const [initiativeModalOpen, setInitiativeModalOpen] = React.useState(false);
  const [initiativeForm, setInitiativeForm] =
    React.useState<InitiativeFormState>(EMPTY_INITIATIVE_FORM);
  const [initiativeSaving, setInitiativeSaving] = React.useState(false);

  // Initiative filter
  const [initiativeCompanyFilter, setInitiativeCompanyFilter] = React.useState<string>("all");
  const [initiativeStatusFilter, setInitiativeStatusFilter] = React.useState<string>("all");

  // Delete confirmation dialog
  const [deleteTarget, setDeleteTarget] = React.useState<
    | { kind: "company"; id: string; label: string }
    | { kind: "initiative"; id: string; label: string }
    | null
  >(null);
  const [deleting, setDeleting] = React.useState(false);

  // Analytics Inspector tabs & filters
  const [teamMode, setTeamMode] = React.useState<"battalion" | "department">("battalion");
  const [expandedTeamId, setExpandedTeamId] = React.useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = React.useState("");
  const [employeeDeptFilter, setEmployeeDeptFilter] = React.useState("all");
  const [employeeStatusFilter, setEmployeeStatusFilter] = React.useState("all");
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState<string | null>(null);
  const [policyEditEmployee, setPolicyEditEmployee] = React.useState<EditablePolicyUser | null>(
    null,
  );

  const loadAnalytics = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await ownerApiFetch<OwnerAnalyticsResponse>("/api/owner/analytics");
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load executive analytics.";
      setError(msg);
      if (isRefresh) {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    if (me?.role === "super_admin") {
      void loadAnalytics(false);
    } else {
      setLoading(false);
    }
  }, [me?.role, loadAnalytics]);

  const employees = React.useMemo(() => data?.employees ?? [], [data?.employees]);
  const companies = React.useMemo(() => data?.companies ?? [], [data?.companies]);
  const initiatives = React.useMemo(() => data?.initiatives ?? [], [data?.initiatives]);
  const battalions = data?.battalions ?? [];
  const departments = data?.departments ?? [];

  const employeeById = React.useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const selectedEmployee = selectedEmployeeId
    ? (employeeById.get(selectedEmployeeId) ?? null)
    : null;

  const filteredInitiatives = React.useMemo(() => {
    return initiatives.filter((item) => {
      if (initiativeCompanyFilter !== "all" && item.companyId !== initiativeCompanyFilter) {
        return false;
      }
      if (initiativeStatusFilter !== "all" && item.status !== initiativeStatusFilter) {
        return false;
      }
      return true;
    });
  }, [initiatives, initiativeCompanyFilter, initiativeStatusFilter]);

  const uniqueDepartments = React.useMemo(() => {
    const set = new Set<string>();
    for (const emp of employees) {
      if (emp.department) set.add(emp.department);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const filteredEmployees = React.useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    return employees.filter((emp) => {
      if (employeeDeptFilter !== "all" && emp.department !== employeeDeptFilter) {
        return false;
      }
      if (employeeStatusFilter !== "all") {
        if (employeeStatusFilter === "overdue" && emp.tasksOverdue === 0) return false;
        if (employeeStatusFilter === "checked_in" && emp.todayAttendanceStatus !== "checked_in") {
          return false;
        }
        if (employeeStatusFilter === "on_leave" && emp.todayAttendanceStatus !== "on_leave") {
          return false;
        }
        if (
          employeeStatusFilter === "not_checked_in" &&
          emp.todayAttendanceStatus !== "not_checked_in"
        ) {
          return false;
        }
      }
      if (!q) return true;
      return (
        emp.fullName.toLowerCase().includes(q) ||
        emp.email.toLowerCase().includes(q) ||
        emp.designation.toLowerCase().includes(q) ||
        emp.department.toLowerCase().includes(q) ||
        emp.battalionNames.some((b) => b.toLowerCase().includes(q)) ||
        emp.companyNames.some((c) => c.toLowerCase().includes(q))
      );
    });
  }, [employees, employeeSearch, employeeDeptFilter, employeeStatusFilter]);

  const modalFilteredMembers = React.useMemo(() => {
    const q = companyMemberFilter.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q) ||
        e.designation.toLowerCase().includes(q),
    );
  }, [employees, companyMemberFilter]);

  if (!me) return null;
  if (me.role !== "super_admin") {
    return <NoAccess />;
  }

  const openAddCompany = () => {
    setCompanyForm(EMPTY_COMPANY_FORM);
    setCompanyMemberFilter("");
    setCompanyModalOpen(true);
  };

  const openEditCompany = (company: OwnerCompanyView) => {
    setCompanyForm({
      id: company.id,
      name: company.name,
      code: company.code,
      vertical: company.vertical,
      description: company.description,
      leadUserId: company.leadUserId ?? NONE_OPTION,
      memberIds: company.memberIds,
      active: company.active,
    });
    setCompanyMemberFilter("");
    setCompanyModalOpen(true);
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyForm.name.trim()) {
      toast.error("Company name is required.");
      return;
    }
    setCompanySaving(true);
    try {
      const payload = {
        name: companyForm.name.trim(),
        code: companyForm.code.trim(),
        vertical: companyForm.vertical.trim(),
        description: companyForm.description.trim(),
        leadUserId: companyForm.leadUserId === NONE_OPTION ? null : companyForm.leadUserId,
        memberIds: companyForm.memberIds,
        active: companyForm.active,
      };
      if (companyForm.id) {
        await ownerApiFetch(`/api/owner/companies/${encodeURIComponent(companyForm.id)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.success(`Updated ${payload.name}.`);
      } else {
        await ownerApiFetch("/api/owner/companies", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success(`Created ${payload.name}.`);
      }
      setCompanyModalOpen(false);
      await loadAnalytics(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save company.");
    } finally {
      setCompanySaving(false);
    }
  };

  const openAddInitiative = (presetCompanyId?: string) => {
    setInitiativeForm({
      ...EMPTY_INITIATIVE_FORM,
      companyId: presetCompanyId || NONE_OPTION,
    });
    setInitiativeModalOpen(true);
  };

  const openEditInitiative = (init: OwnerInitiativeView) => {
    setInitiativeForm({
      id: init.id,
      title: init.title,
      description: init.description,
      companyId: init.companyId ?? NONE_OPTION,
      battalionId: init.battalionId ?? NONE_OPTION,
      leadUserId: init.leadUserId ?? NONE_OPTION,
      status: init.status,
      progress: init.progress,
      dueDate: init.dueDate ?? "",
    });
    setInitiativeModalOpen(true);
  };

  const handleSaveInitiative = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initiativeForm.title.trim()) {
      toast.error("Initiative title is required.");
      return;
    }
    setInitiativeSaving(true);
    try {
      const payload = {
        title: initiativeForm.title.trim(),
        description: initiativeForm.description.trim(),
        companyId: initiativeForm.companyId === NONE_OPTION ? null : initiativeForm.companyId,
        battalionId: initiativeForm.battalionId === NONE_OPTION ? null : initiativeForm.battalionId,
        leadUserId: initiativeForm.leadUserId === NONE_OPTION ? null : initiativeForm.leadUserId,
        status: initiativeForm.status,
        progress:
          initiativeForm.status === "completed"
            ? 100
            : Math.max(0, Math.min(100, Number(initiativeForm.progress) || 0)),
        dueDate: initiativeForm.dueDate.trim() || null,
      };
      if (initiativeForm.id) {
        await ownerApiFetch(`/api/owner/initiatives/${encodeURIComponent(initiativeForm.id)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.success(`Updated initiative "${payload.title}".`);
      } else {
        await ownerApiFetch("/api/owner/initiatives", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success(`Created initiative "${payload.title}".`);
      }
      setInitiativeModalOpen(false);
      await loadAnalytics(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save initiative.");
    } finally {
      setInitiativeSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === "company") {
        await ownerApiFetch(`/api/owner/companies/${encodeURIComponent(deleteTarget.id)}`, {
          method: "DELETE",
        });
        toast.success(`Deleted company "${deleteTarget.label}".`);
      } else {
        await ownerApiFetch(`/api/owner/initiatives/${encodeURIComponent(deleteTarget.id)}`, {
          method: "DELETE",
        });
        toast.success(`Deleted initiative "${deleteTarget.label}".`);
      }
      setDeleteTarget(null);
      await loadAnalytics(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete item.");
    } finally {
      setDeleting(false);
    }
  };

  const toggleCompanyMember = (userId: string) => {
    setCompanyForm((prev) => {
      const exists = prev.memberIds.includes(userId);
      return {
        ...prev,
        memberIds: exists
          ? prev.memberIds.filter((id) => id !== userId)
          : [...prev.memberIds, userId],
      };
    });
  };

  const kpis = data?.kpis;
  const activeTeamList = teamMode === "battalion" ? battalions : departments;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Owner's Executive Dashboard"
        description={
          data?.generatedAt
            ? `Real-time portfolio, workforce & accountability telemetry · Updated ${fmtTime(data.generatedAt)}`
            : "Super Admin executive overview across companies, strategic initiatives, Battalion squads, and individual performance."
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadAnalytics(true)}
              disabled={refreshing || loading}
              className="gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={openAddCompany} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add Company
            </Button>
            <Button
              size="sm"
              onClick={() => openAddInitiative()}
              className="gap-1.5 bg-[#5B00A3] text-white hover:bg-[#490083]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Initiative
            </Button>
          </>
        }
      />

      {error && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2.5 text-sm text-rose-700 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => void loadAnalytics(true)}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((idx) => (
            <Card key={idx} className="h-36 animate-pulse bg-card/70" />
          ))}
        </div>
      ) : kpis ? (
        <>
          {/* 1. TOP EXECUTIVE KPI SUMMARY CARDS */}
          <section
            aria-label="Executive KPI Summary"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            {/* Total Companies */}
            <Card className="border-border bg-card shadow-xs">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Total Companies
                    </p>
                    <p className="mt-2 text-3xl font-bold tracking-tight text-foreground tabular-nums">
                      {kpis.totalCompanies}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2D0029]/10 text-[#2D0029] dark:bg-purple-500/15 dark:text-purple-200">
                    <Building2 className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                  <span>
                    <strong className="font-semibold text-foreground">
                      {kpis.activeCompanies}
                    </strong>{" "}
                    active
                  </span>
                  <span>
                    <strong className="font-semibold text-foreground">
                      {kpis.totalAssignedCompanyStaff}
                    </strong>{" "}
                    assigned staff
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Active Initiatives */}
            <Card className="border-border bg-card shadow-xs">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Active Initiatives
                    </p>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                        {kpis.activeInitiatives}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground tabular-nums">
                        / {kpis.totalInitiatives} total
                      </span>
                    </div>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5B00A3]/10 text-[#5B00A3] dark:bg-purple-500/15 dark:text-purple-200">
                    <Target className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="text-muted-foreground">Overall completion</span>
                    <span className="font-semibold text-foreground">
                      {kpis.overallInitiativeCompletionPct}%
                    </span>
                  </div>
                  <MiniProgressBar value={kpis.overallInitiativeCompletionPct} tone="brand" />
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {kpis.completedInitiatives} completed ·{" "}
                    <span
                      className={kpis.atRiskInitiatives > 0 ? "font-semibold text-rose-600" : ""}
                    >
                      {kpis.atRiskInitiatives} at risk
                    </span>
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Workforce & Today's Attendance */}
            <Card className="border-border bg-card shadow-xs">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Workforce & Today
                    </p>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                        {kpis.checkedInTodayCount}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground tabular-nums">
                        / {kpis.activeStaffCount} active staff
                      </span>
                    </div>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                    <Users className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="text-muted-foreground">Check-in rate</span>
                    <span className="font-semibold text-foreground">
                      {kpis.attendanceRateTodayPct}%
                    </span>
                  </div>
                  <MiniProgressBar value={kpis.attendanceRateTodayPct} tone="emerald" />
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {kpis.onLeaveTodayCount} on leave ·{" "}
                    <span className={kpis.lateTodayCount > 0 ? "font-semibold text-amber-600" : ""}>
                      {kpis.lateTodayCount} late
                    </span>{" "}
                    · {kpis.notCheckedInCount} pending
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Task & EOD Health */}
            <Card className="border-border bg-card shadow-xs">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Task & EOD Health
                    </p>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                        {kpis.taskCompletionRatePct}%
                      </span>
                      <span className="text-xs font-medium text-muted-foreground tabular-nums">
                        {kpis.tasksCompleted}/{kpis.tasksTotal} tasks
                      </span>
                    </div>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#8A007E]/10 text-[#8A007E] dark:bg-fuchsia-500/15 dark:text-fuchsia-200">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="text-muted-foreground">Today's EOD rate</span>
                    <span className="font-semibold text-foreground">
                      {kpis.eodRateTodayPct}% ({kpis.eodsSubmittedToday}/{kpis.eodExpectedToday})
                    </span>
                  </div>
                  <MiniProgressBar
                    value={kpis.eodRateTodayPct}
                    tone={kpis.tasksOverdue > 0 ? "amber" : "brand"}
                  />
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {kpis.tasksPending} open ·{" "}
                    <span className={kpis.tasksOverdue > 0 ? "font-semibold text-rose-600" : ""}>
                      {kpis.tasksOverdue} overdue
                    </span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* 2. COMPANIES & INITIATIVES MANAGEMENT SECTION */}
          <section aria-label="Companies and Initiatives" className="grid gap-6 xl:grid-cols-12">
            {/* Companies / Verticals Panel */}
            <Card className="border-border bg-card shadow-xs xl:col-span-5">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/60 pb-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Building2 className="h-4 w-4 text-[#5B00A3]" />
                    Companies & Verticals
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Organization units, leads, and assigned workforce
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={openAddCompany} className="h-8 gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </CardHeader>
              <CardContent className="p-4">
                {companies.length === 0 ? (
                  <EmptyState
                    icon={Building2}
                    title="No companies added yet"
                    description="Create companies or business verticals to group staff and track strategic initiatives."
                    action={
                      <Button size="sm" onClick={openAddCompany} className="gap-1.5">
                        <Plus className="h-3.5 w-3.5" />
                        Add Company
                      </Button>
                    }
                  />
                ) : (
                  <div className="divide-y divide-border/60">
                    {companies.map((company) => (
                      <div
                        key={company.id}
                        className="flex flex-col gap-2.5 py-3.5 first:pt-1 last:pb-1"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold text-foreground truncate">
                                {company.name}
                              </h3>
                              {company.code && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  {company.code}
                                </span>
                              )}
                              {!company.active && (
                                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  Inactive
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {company.vertical || "General Vertical"}
                              {company.leadName ? ` · Lead: ${company.leadName}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => openEditCompany(company)}
                              title={`Edit ${company.name}`}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-rose-600"
                              onClick={() =>
                                setDeleteTarget({
                                  kind: "company",
                                  id: company.id,
                                  label: company.name,
                                })
                              }
                              title={`Delete ${company.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {company.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {company.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                          <div className="flex items-center gap-3 text-muted-foreground">
                            <span>
                              <strong className="font-semibold text-foreground">
                                {company.staffCount}
                              </strong>{" "}
                              staff
                            </span>
                            <span>
                              <strong className="font-semibold text-foreground">
                                {company.initiativeCount}
                              </strong>{" "}
                              initiatives
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">
                              Avg {company.avgInitiativeProgress}%
                            </span>
                            <button
                              type="button"
                              onClick={() => openAddInitiative(company.id)}
                              className="text-[11px] font-medium text-[#5B00A3] hover:underline dark:text-purple-300"
                            >
                              + Initiative
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Strategic Initiatives Panel */}
            <Card className="border-border bg-card shadow-xs xl:col-span-7">
              <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 pb-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Target className="h-4 w-4 text-[#8A007E]" />
                    Strategic Initiatives
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Company goals, Battalion ownership, delivery status, and completion %
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={initiativeCompanyFilter}
                    onValueChange={setInitiativeCompanyFilter}
                  >
                    <SelectTrigger className="h-8 w-[145px] text-xs">
                      <SelectValue placeholder="All companies" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All companies</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={initiativeStatusFilter} onValueChange={setInitiativeStatusFilter}>
                    <SelectTrigger className="h-8 w-[125px] text-xs">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {INITIATIVE_STATUS_VALUES.map((st) => (
                        <SelectItem key={st} value={st}>
                          {INITIATIVE_STATUS_LABELS[st]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={() => openAddInitiative()}
                    className="h-8 gap-1 bg-[#5B00A3] text-white hover:bg-[#490083]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                {filteredInitiatives.length === 0 ? (
                  <EmptyState
                    icon={Target}
                    title={
                      initiatives.length === 0
                        ? "No strategic initiatives yet"
                        : "No initiatives match these filters"
                    }
                    description={
                      initiatives.length === 0
                        ? "Track high-priority milestones across companies and Battalion squads."
                        : "Reset filters or create a new initiative."
                    }
                    action={
                      initiatives.length === 0 ? (
                        <Button size="sm" onClick={() => openAddInitiative()} className="gap-1.5">
                          <Plus className="h-3.5 w-3.5" />
                          Add Initiative
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setInitiativeCompanyFilter("all");
                            setInitiativeStatusFilter("all");
                          }}
                        >
                          Clear Filters
                        </Button>
                      )
                    }
                  />
                ) : (
                  <div className="divide-y divide-border/60">
                    {filteredInitiatives.map((init) => (
                      <div
                        key={init.id}
                        className="flex flex-col gap-3 py-3.5 first:pt-1 last:pb-1"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold text-foreground">{init.title}</h3>
                              <InitiativeStatusBadge status={init.status} />
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {init.companyName ? init.companyName : "Organization-wide"}
                              {init.battalionName ? ` · ${init.battalionName}` : ""}
                              {init.leadName ? ` · Lead: ${init.leadName}` : ""}
                              {init.dueDate ? ` · Due ${fmtDate(init.dueDate)}` : ""}
                            </p>
                            {init.description && (
                              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                                {init.description}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => openEditInitiative(init)}
                              title={`Edit ${init.title}`}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-rose-600"
                              onClick={() =>
                                setDeleteTarget({
                                  kind: "initiative",
                                  id: init.id,
                                  label: init.title,
                                })
                              }
                              title={`Delete ${init.title}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <MiniProgressBar
                              value={init.progress}
                              tone={
                                init.status === "at_risk"
                                  ? "rose"
                                  : init.status === "completed"
                                    ? "emerald"
                                    : "brand"
                              }
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-semibold text-foreground tabular-nums">
                            {init.progress}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* 3. TEAM & INDIVIDUAL EMPLOYEE ANALYTICS INSPECTOR (TWO-TAB SWITCHER) */}
          <section aria-label="Team and Employee Analytics Inspector">
            <Card className="border-border bg-card shadow-xs">
              <CardContent className="p-5 sm:p-6">
                <Tabs defaultValue="teams" className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        Workforce & Squad Analytics Inspector
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Compare Battalion squads or departments and inspect individual employee
                        output
                      </p>
                    </div>
                    <TabsList className="bg-muted/80">
                      <TabsTrigger value="teams" className="gap-1.5">
                        <Layers className="h-3.5 w-3.5" />
                        Team / Battalion Analytics
                      </TabsTrigger>
                      <TabsTrigger value="employees" className="gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        Individual Employee Inspector ({employees.length})
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {/* TAB 1: TEAM / BATTALION ANALYTICS */}
                  <TabsContent value="teams" className="space-y-4 mt-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
                        <button
                          type="button"
                          onClick={() => {
                            setTeamMode("battalion");
                            setExpandedTeamId(null);
                          }}
                          className={cn(
                            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                            teamMode === "battalion"
                              ? "bg-[#5B00A3] text-white shadow-xs"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          Battalion Squads ({battalions.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTeamMode("department");
                            setExpandedTeamId(null);
                          }}
                          className={cn(
                            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                            teamMode === "department"
                              ? "bg-[#5B00A3] text-white shadow-xs"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          Departments ({departments.length})
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Click any squad row to expand and inspect its members
                      </p>
                    </div>

                    {activeTeamList.length === 0 ? (
                      <EmptyState
                        icon={Layers}
                        title={
                          teamMode === "battalion"
                            ? "No Battalion squads configured"
                            : "No departments found"
                        }
                        description={
                          teamMode === "battalion"
                            ? "Create Battalion squads in the Battalion directory to view live squad comparisons."
                            : "Assign departments to team members to inspect department metrics."
                        }
                      />
                    ) : (
                      <div className="space-y-3">
                        {activeTeamList.map((team) => {
                          const isExpanded = expandedTeamId === team.id;
                          const squadMembers = team.memberIds
                            .map((id) => employeeById.get(id))
                            .filter((m): m is OwnerEmployeeAnalytics => Boolean(m));
                          const totalTeamTasks = team.tasksCompleted + team.tasksPending;
                          const taskPct =
                            totalTeamTasks > 0
                              ? Math.round((team.tasksCompleted / totalTeamTasks) * 100)
                              : 0;

                          return (
                            <div
                              key={team.id}
                              className="overflow-hidden rounded-xl border border-border bg-background/40 transition-colors"
                            >
                              <button
                                type="button"
                                onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                                className="flex w-full flex-col gap-4 p-4 text-left hover:bg-muted/30 transition-colors"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="flex items-start gap-2.5 min-w-0">
                                    <span className="mt-0.5 text-muted-foreground">
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                    </span>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-semibold text-foreground">
                                          {team.name}
                                        </h3>
                                        <span className="rounded-full bg-[#5B00A3]/10 px-2 py-0.5 text-[11px] font-semibold text-[#5B00A3] dark:text-purple-300 tabular-nums">
                                          {team.memberCount} members
                                        </span>
                                        <span className="text-xs text-muted-foreground tabular-nums">
                                          {team.checkedInToday} checked in · {team.onLeaveToday} on
                                          leave
                                        </span>
                                      </div>
                                      {team.description && (
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                          {team.description}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
                                    <div>
                                      <span className="text-muted-foreground">Tasks: </span>
                                      <strong className="font-semibold text-foreground">
                                        {team.tasksCompleted} done
                                      </strong>
                                      <span className="text-muted-foreground">
                                        {" "}
                                        / {team.tasksPending} open
                                      </span>
                                      {team.tasksOverdue > 0 && (
                                        <span className="ml-1.5 font-semibold text-rose-600">
                                          ({team.tasksOverdue} overdue)
                                        </span>
                                      )}
                                      <span className="ml-1.5 text-muted-foreground">
                                        ({taskPct}%)
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">EOD Rate: </span>
                                      <strong
                                        className={cn(
                                          "font-semibold",
                                          team.eodComplianceRatePct >= 80
                                            ? "text-emerald-600"
                                            : team.eodComplianceRatePct >= 50
                                              ? "text-amber-600"
                                              : "text-foreground",
                                        )}
                                      >
                                        {team.eodComplianceRatePct}%
                                      </strong>
                                    </div>
                                  </div>
                                </div>

                                <StatusDistributionBar
                                  dist={team.statusDistribution}
                                  total={team.memberCount}
                                />
                              </button>

                              {isExpanded && (
                                <div className="border-t border-border/70 bg-card/60 p-4">
                                  {squadMembers.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                      No visible employees assigned to this group.
                                    </p>
                                  ) : (
                                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                                      {squadMembers.map((member) => (
                                        <button
                                          key={member.id}
                                          type="button"
                                          onClick={() => setSelectedEmployeeId(member.id)}
                                          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-[#5B00A3]/50 hover:bg-muted/30"
                                        >
                                          <div className="flex min-w-0 items-center gap-2.5">
                                            <Initials
                                              name={member.fullName}
                                              color={member.avatarColor}
                                              src={member.avatarUrl}
                                              size={34}
                                            />
                                            <div className="min-w-0">
                                              <p className="truncate text-sm font-semibold text-foreground">
                                                {member.fullName}
                                              </p>
                                              <p className="truncate text-[11px] text-muted-foreground">
                                                {member.designation}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="flex flex-col items-end gap-1 shrink-0">
                                            <LivePresenceBadge
                                              status={member.liveStatus}
                                              expired={member.liveExpired}
                                            />
                                            <span className="text-[11px] text-muted-foreground tabular-nums">
                                              {member.tasksCompleted}/{member.tasksTotal} tasks
                                            </span>
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </TabsContent>

                  {/* TAB 2: INDIVIDUAL EMPLOYEE INSPECTOR */}
                  <TabsContent value="employees" className="space-y-4 mt-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="relative min-w-[220px] flex-1 max-w-md">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={employeeSearch}
                          onChange={(e) => setEmployeeSearch(e.target.value)}
                          placeholder="Search name, email, department, Battalion, company..."
                          className="h-9 pl-9 pr-8 text-sm"
                        />
                        {employeeSearch && (
                          <button
                            type="button"
                            onClick={() => setEmployeeSearch("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label="Clear search"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={employeeDeptFilter} onValueChange={setEmployeeDeptFilter}>
                          <SelectTrigger className="h-9 w-[150px] text-xs">
                            <SelectValue placeholder="All departments" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All departments</SelectItem>
                            {uniqueDepartments.map((dept) => (
                              <SelectItem key={dept} value={dept}>
                                {dept}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={employeeStatusFilter}
                          onValueChange={setEmployeeStatusFilter}
                        >
                          <SelectTrigger className="h-9 w-[155px] text-xs">
                            <SelectValue placeholder="All attendance" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All employees</SelectItem>
                            <SelectItem value="checked_in">Checked in today</SelectItem>
                            <SelectItem value="on_leave">On leave today</SelectItem>
                            <SelectItem value="not_checked_in">Not checked in</SelectItem>
                            <SelectItem value="overdue">Has overdue tasks</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {filteredEmployees.length === 0 ? (
                      <EmptyState
                        icon={Users}
                        title="No matching employees"
                        description="Adjust your search query or filters to inspect employee records."
                        action={
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEmployeeSearch("");
                              setEmployeeDeptFilter("all");
                              setEmployeeStatusFilter("all");
                            }}
                          >
                            Reset Filters
                          </Button>
                        }
                      />
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-border">
                        <table className="w-full border-collapse text-left text-sm">
                          <thead>
                            <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              <th className="px-4 py-3">Employee</th>
                              <th className="px-3 py-3">Policy</th>
                              <th className="px-3 py-3">Live Status</th>
                              <th className="px-3 py-3">Today</th>
                              <th className="px-3 py-3 text-right">Attendance %</th>
                              <th className="px-3 py-3 text-right">Tasks Done</th>
                              <th className="px-3 py-3 text-right">Overdue</th>
                              <th className="px-3 py-3 text-right">EODs</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {filteredEmployees.map((emp) => (
                              <tr
                                key={emp.id}
                                onClick={() => setSelectedEmployeeId(emp.id)}
                                className="cursor-pointer transition-colors hover:bg-muted/35"
                              >
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-3">
                                    <Initials
                                      name={emp.fullName}
                                      color={emp.avatarColor}
                                      src={emp.avatarUrl}
                                      size={34}
                                    />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <p className="font-semibold text-foreground truncate">
                                          {emp.fullName}
                                        </p>
                                        {!emp.active && (
                                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                            Inactive
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground truncate">
                                        {emp.designation} · {emp.department}
                                      </p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-3">
                                  <UserPolicyBadge user={emp} />
                                </td>
                                <td className="px-3 py-3">
                                  <LivePresenceBadge
                                    status={emp.liveStatus}
                                    expired={emp.liveExpired}
                                  />
                                </td>
                                <td className="px-3 py-3">
                                  <div className="space-y-0.5">
                                    <TodayAttendanceBadge state={emp.todayAttendanceStatus} />
                                    {emp.todayPunchIn && (
                                      <p className="text-[11px] text-muted-foreground tabular-nums">
                                        In {fmtTime(emp.todayPunchIn)}
                                        {emp.todayLateMinutes > 0
                                          ? ` (+${emp.todayLateMinutes}m)`
                                          : ""}
                                      </p>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-right font-medium text-foreground tabular-nums">
                                  {emp.attendanceRatePct}%
                                </td>
                                <td className="px-3 py-3 text-right text-foreground tabular-nums">
                                  <strong className="font-semibold">{emp.tasksCompleted}</strong>
                                  <span className="text-muted-foreground"> / {emp.tasksTotal}</span>
                                </td>
                                <td className="px-3 py-3 text-right tabular-nums">
                                  <span
                                    className={cn(
                                      "font-semibold",
                                      emp.tasksOverdue > 0
                                        ? "text-rose-600"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    {emp.tasksOverdue}
                                  </span>
                                </td>
                                <td className="px-3 py-3 text-right tabular-nums">
                                  <span className="font-medium text-foreground">
                                    {emp.eodsSubmittedTotal}
                                  </span>
                                  {emp.eodSubmittedToday && (
                                    <span className="ml-1.5 inline-block rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                      Today
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}

      {/* ADD / EDIT COMPANY MODAL */}
      <Dialog open={companyModalOpen} onOpenChange={setCompanyModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{companyForm.id ? "Edit Company" : "Add Company / Vertical"}</DialogTitle>
            <DialogDescription>
              Group workforce members and link strategic initiatives under an organization unit.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveCompany} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cmp-name">Company Name *</Label>
                <Input
                  id="cmp-name"
                  value={companyForm.name}
                  onChange={(e) => setCompanyForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. SACE EdTech Division"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cmp-code">Code</Label>
                <Input
                  id="cmp-code"
                  value={companyForm.code}
                  onChange={(e) => setCompanyForm((p) => ({ ...p, code: e.target.value }))}
                  placeholder="e.g. SACE-EDU"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cmp-vertical">Vertical / Industry</Label>
                <Input
                  id="cmp-vertical"
                  value={companyForm.vertical}
                  onChange={(e) => setCompanyForm((p) => ({ ...p, vertical: e.target.value }))}
                  placeholder="e.g. Higher Education & IELTS"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Company Lead</Label>
                <Select
                  value={companyForm.leadUserId}
                  onValueChange={(val) => setCompanyForm((p) => ({ ...p, leadUserId: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select lead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_OPTION}>Unassigned</SelectItem>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cmp-desc">Description</Label>
              <Textarea
                id="cmp-desc"
                rows={2}
                value={companyForm.description}
                onChange={(e) => setCompanyForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Brief summary of responsibilities and objectives"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Assigned Staff ({companyForm.memberIds.length} selected)</Label>
                <Input
                  value={companyMemberFilter}
                  onChange={(e) => setCompanyMemberFilter(e.target.value)}
                  placeholder="Filter staff..."
                  className="h-7 w-40 text-xs"
                />
              </div>
              <ScrollArea className="h-40 rounded-lg border border-border p-2.5">
                <div className="space-y-2">
                  {modalFilteredMembers.map((emp) => {
                    const checked = companyForm.memberIds.includes(emp.id);
                    return (
                      <label
                        key={emp.id}
                        className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleCompanyMember(emp.id)}
                          />
                          <span className="truncate text-sm font-medium text-foreground">
                            {emp.fullName}
                          </span>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {emp.department}
                        </span>
                      </label>
                    );
                  })}
                  {modalFilteredMembers.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      No matching staff members.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">Active Company</p>
                <p className="text-xs text-muted-foreground">
                  Include in active portfolio headcount KPIs
                </p>
              </div>
              <Switch
                checked={companyForm.active}
                onCheckedChange={(val) => setCompanyForm((p) => ({ ...p, active: val }))}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCompanyModalOpen(false)}
                disabled={companySaving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={companySaving}
                className="bg-[#5B00A3] text-white hover:bg-[#490083]"
              >
                {companySaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {companyForm.id ? "Save Changes" : "Create Company"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ADD / EDIT INITIATIVE MODAL */}
      <Dialog open={initiativeModalOpen} onOpenChange={setInitiativeModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {initiativeForm.id ? "Edit Strategic Initiative" : "Add Strategic Initiative"}
            </DialogTitle>
            <DialogDescription>
              Link an executive milestone to a company, Battalion squad, and accountable owner.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveInitiative} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="init-title">Initiative Title *</Label>
              <Input
                id="init-title"
                value={initiativeForm.title}
                onChange={(e) => setInitiativeForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Q4 Enterprise Admissions Pipeline"
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Company</Label>
                <Select
                  value={initiativeForm.companyId}
                  onValueChange={(val) => setInitiativeForm((p) => ({ ...p, companyId: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_OPTION}>Organization-wide</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Battalion Squad</Label>
                <Select
                  value={initiativeForm.battalionId}
                  onValueChange={(val) => setInitiativeForm((p) => ({ ...p, battalionId: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Battalion" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_OPTION}>No Battalion</SelectItem>
                    {battalions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Lead Owner</Label>
                <Select
                  value={initiativeForm.leadUserId}
                  onValueChange={(val) => setInitiativeForm((p) => ({ ...p, leadUserId: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select lead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_OPTION}>Unassigned</SelectItem>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="init-due">Target Date</Label>
                <Input
                  id="init-due"
                  type="date"
                  value={initiativeForm.dueDate}
                  onChange={(e) => setInitiativeForm((p) => ({ ...p, dueDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={initiativeForm.status}
                  onValueChange={(val) => {
                    const nextStatus = val as InitiativeStatus;
                    setInitiativeForm((p) => ({
                      ...p,
                      status: nextStatus,
                      progress: nextStatus === "completed" ? 100 : p.progress,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INITIATIVE_STATUS_VALUES.map((st) => (
                      <SelectItem key={st} value={st}>
                        {INITIATIVE_STATUS_LABELS[st]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="init-progress">Progress ({initiativeForm.progress}%)</Label>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    id="init-progress"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={initiativeForm.progress}
                    onChange={(e) =>
                      setInitiativeForm((p) => ({
                        ...p,
                        progress: Number(e.target.value) || 0,
                      }))
                    }
                    className="w-full accent-[#5B00A3]"
                  />
                  <span className="w-10 text-right text-xs font-semibold tabular-nums">
                    {initiativeForm.progress}%
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="init-desc">Notes / Scope</Label>
              <Textarea
                id="init-desc"
                rows={2}
                value={initiativeForm.description}
                onChange={(e) => setInitiativeForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Deliverables, milestones, or blockers"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInitiativeModalOpen(false)}
                disabled={initiativeSaving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={initiativeSaving}
                className="bg-[#5B00A3] text-white hover:bg-[#490083]"
              >
                {initiativeSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {initiativeForm.id ? "Save Changes" : "Create Initiative"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION DIALOG */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.kind === "company" ? "Company" : "Initiative"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "company"
                ? `This will permanently remove "${deleteTarget.label}". Linked initiatives will remain as organization-wide items.`
                : `This will permanently remove initiative "${deleteTarget?.label ?? ""}".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              disabled={deleting}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* INDIVIDUAL EMPLOYEE WORK & ANALYTICS DRAWER */}
      <Sheet
        open={Boolean(selectedEmployee)}
        onOpenChange={(open) => {
          if (!open) setSelectedEmployeeId(null);
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
          {selectedEmployee && (
            <>
              <div className="border-b border-border bg-gradient-to-r from-[#2D0029] via-[#5B00A3] to-[#8A007E] p-6 text-white">
                <SheetHeader className="text-left">
                  <div className="flex items-start gap-3.5 pr-6">
                    <Initials
                      name={selectedEmployee.fullName}
                      color={selectedEmployee.avatarColor}
                      src={selectedEmployee.avatarUrl}
                      size={48}
                    />
                    <div className="min-w-0 flex-1">
                      <SheetTitle className="text-lg font-bold text-white">
                        {selectedEmployee.fullName}
                      </SheetTitle>
                      <SheetDescription className="text-purple-100/90 text-xs mt-0.5">
                        {selectedEmployee.designation} · {selectedEmployee.department} ·{" "}
                        {roleLabel(selectedEmployee.role)}
                      </SheetDescription>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-purple-100">
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" />
                          {selectedEmployee.email}
                        </span>
                        {selectedEmployee.reportingAdminName && (
                          <span className="inline-flex items-center gap-1">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Reports to {selectedEmployee.reportingAdminName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </SheetHeader>
              </div>

              <ScrollArea className="flex-1 p-6">
                <div className="space-y-6">
                  {/* Snapshot Metrics */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-border bg-card p-3">
                      <p className="text-[11px] font-medium text-muted-foreground">Live Status</p>
                      <div className="mt-1.5">
                        <LivePresenceBadge
                          status={selectedEmployee.liveStatus}
                          expired={selectedEmployee.liveExpired}
                        />
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-3">
                      <p className="text-[11px] font-medium text-muted-foreground">Attendance</p>
                      <p className="mt-1 text-lg font-bold text-foreground tabular-nums">
                        {selectedEmployee.attendanceRatePct}%
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {selectedEmployee.daysPresent}/{selectedEmployee.totalTrackedDays} days
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-3">
                      <p className="text-[11px] font-medium text-muted-foreground">Tasks</p>
                      <p className="mt-1 text-lg font-bold text-foreground tabular-nums">
                        {selectedEmployee.tasksCompleted}/{selectedEmployee.tasksTotal}
                      </p>
                      <p
                        className={cn(
                          "text-[11px] tabular-nums",
                          selectedEmployee.tasksOverdue > 0
                            ? "font-semibold text-rose-600"
                            : "text-muted-foreground",
                        )}
                      >
                        {selectedEmployee.tasksOverdue} overdue
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-3">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        Leave Balances
                      </p>
                      <p className="mt-1 text-sm font-bold text-foreground tabular-nums">
                        CL {selectedEmployee.casualBalance} · SL {selectedEmployee.sickBalance}
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {selectedEmployee.eodsSubmittedTotal} EODs total
                      </p>
                    </div>
                  </div>

                  {/* Work Schedule & Attendance Policy Summary */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5">
                    <div className="space-y-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5 text-[#5B00A3]" />
                        Work Schedule & Attendance Policy
                      </p>
                      <UserPolicyBadge user={selectedEmployee} />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPolicyEditEmployee(selectedEmployee)}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-[#5B00A3]" />
                      Edit Schedule & Policy
                    </Button>
                  </div>

                  {/* Battalions & Companies */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border bg-card p-3.5">
                      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-[#5B00A3]" />
                        Battalion Squads
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedEmployee.battalionNames.length > 0 ? (
                          selectedEmployee.battalionNames.map((name) => (
                            <span
                              key={name}
                              className="rounded-md bg-[#5B00A3]/10 px-2 py-0.5 text-xs font-medium text-[#5B00A3] dark:text-purple-300"
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">Not in a Battalion</span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-3.5">
                      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-[#8A007E]" />
                        Assigned Companies
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedEmployee.companyNames.length > 0 ? (
                          selectedEmployee.companyNames.map((name) => (
                            <span
                              key={name}
                              className="rounded-md bg-[#8A007E]/10 px-2 py-0.5 text-xs font-medium text-[#8A007E] dark:text-fuchsia-300"
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            No company assignment
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Detailed Tabs inside Drawer */}
                  <Tabs defaultValue="tasks" className="space-y-3">
                    <TabsList className="grid w-full grid-cols-4">
                      <TabsTrigger value="tasks" className="text-xs">
                        Tasks ({selectedEmployee.recentTasks.length})
                      </TabsTrigger>
                      <TabsTrigger value="eod" className="text-xs">
                        EODs ({selectedEmployee.recentEods.length})
                      </TabsTrigger>
                      <TabsTrigger value="attendance" className="text-xs">
                        Attendance ({selectedEmployee.recentAttendance.length})
                      </TabsTrigger>
                      <TabsTrigger value="leaves" className="text-xs">
                        Leaves ({selectedEmployee.recentLeaves.length})
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="tasks" className="space-y-2">
                      {selectedEmployee.recentTasks.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                          No tasks assigned to this employee.
                        </p>
                      ) : (
                        selectedEmployee.recentTasks.map((t) => (
                          <div
                            key={t.id}
                            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{t.title}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                                Priority: {titleCase(t.priority)} · Due{" "}
                                {t.dueDate ? fmtDate(t.dueDate) : "—"}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                t.status === "completed" || t.status === "approved"
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : "border-border bg-muted/60 text-foreground",
                              )}
                            >
                              {titleCase(t.status)}
                            </span>
                          </div>
                        ))
                      )}
                    </TabsContent>

                    <TabsContent value="eod" className="space-y-2">
                      {selectedEmployee.recentEods.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                          No EOD reports submitted yet.
                        </p>
                      ) : (
                        selectedEmployee.recentEods.map((eod) => (
                          <div
                            key={eod.id}
                            className="space-y-1.5 rounded-lg border border-border bg-card p-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground tabular-nums">
                                <FileText className="h-3.5 w-3.5 text-[#5B00A3]" />
                                {fmtDate(eod.date)} · {Number(eod.hours) || 0}h
                              </span>
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                {fmtDateTime(eod.submittedAt)}
                              </span>
                            </div>
                            {eod.worked && (
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                <strong className="font-medium text-foreground">Worked:</strong>{" "}
                                {eod.worked}
                              </p>
                            )}
                            {eod.completed && (
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                <strong className="font-medium text-foreground">Completed:</strong>{" "}
                                {eod.completed}
                              </p>
                            )}
                            {eod.blockers && (
                              <p className="text-xs text-rose-600 dark:text-rose-400">
                                Blockers: {eod.blockers}
                              </p>
                            )}
                          </div>
                        ))
                      )}
                    </TabsContent>

                    <TabsContent value="attendance" className="space-y-2">
                      {selectedEmployee.recentAttendance.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                          No attendance logs recorded.
                        </p>
                      ) : (
                        selectedEmployee.recentAttendance.map((att) => (
                          <div
                            key={att.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-xs tabular-nums"
                          >
                            <div className="flex items-center gap-2">
                              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-medium text-foreground">
                                {fmtDate(att.date)}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-muted-foreground">
                              <span>
                                In:{" "}
                                <strong className="text-foreground">
                                  {att.punchIn ? fmtTime(att.punchIn) : "—"}
                                </strong>
                              </span>
                              <span>
                                Out:{" "}
                                <strong className="text-foreground">
                                  {att.punchOut ? fmtTime(att.punchOut) : "—"}
                                </strong>
                              </span>
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                                {titleCase(att.status ?? "present")}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </TabsContent>

                    <TabsContent value="leaves" className="space-y-2">
                      {selectedEmployee.recentLeaves.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                          No leave applications recorded.
                        </p>
                      ) : (
                        selectedEmployee.recentLeaves.map((lv) => (
                          <div
                            key={lv.id}
                            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3"
                          >
                            <div className="space-y-0.5">
                              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground tabular-nums">
                                <Plane className="h-3.5 w-3.5 text-[#8A007E]" />
                                {titleCase(lv.type)} Leave · {fmtDate(lv.startDate)} →{" "}
                                {fmtDate(lv.endDate)}
                              </p>
                              {lv.reason && (
                                <p className="text-xs text-muted-foreground">{lv.reason}</p>
                              )}
                            </div>
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                lv.status === "approved"
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : lv.status === "rejected"
                                    ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                              )}
                            >
                              {titleCase(lv.status)}
                            </span>
                          </div>
                        ))
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>

      <EditUserPolicyDialog
        user={policyEditEmployee}
        open={Boolean(policyEditEmployee)}
        onOpenChange={(open) => {
          if (!open) setPolicyEditEmployee(null);
        }}
        onSaved={() => {
          void loadAnalytics(true);
        }}
      />
    </div>
  );
}
