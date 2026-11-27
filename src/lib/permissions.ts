import type { Role } from "./types.ts";

export const MODULE_KEYS = [
  "dashboard",
  "owner_dashboard",
  "tasks",
  "attendance",
  "eod",
  "battalion",
  "mom",
  "messages_tickets",
  "vault",
  "leave",
  "companies_initiatives",
  "user_management",
  "audit",
  "addy_ai",
  "settings_integrations",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModulePermission {
  view: boolean;
  edit: boolean;
}

export type ModulePermissionsMap = Record<ModuleKey, ModulePermission>;

export interface PortalModuleDefinition {
  key: ModuleKey;
  label: string;
  description: string;
  routes: string[];
  category: "core" | "operations" | "administration";
}

export const PORTAL_MODULES: PortalModuleDefinition[] = [
  {
    key: "dashboard",
    label: "Dashboard & Daily Vision",
    description: "Daily vision, personal to-dos, shift overview, and KPI summary cards",
    routes: ["/dashboard", "/leads", "/leaderboard"],
    category: "core",
  },
  {
    key: "owner_dashboard",
    label: "Owner's Executive Dashboard",
    description: "Executive command center across workforce, attendance, tasks, and KPIs",
    routes: ["/owner-dashboard"],
    category: "administration",
  },
  {
    key: "tasks",
    label: "Tasks & Planner",
    description: "Today / Weekly / Monthly / Quarterly planner, proofs, and reviews",
    routes: ["/tasks", "/reviews"],
    category: "operations",
  },
  {
    key: "attendance",
    label: "Attendance & Punch In/Out",
    description: "GPS geofenced punch in/out, shift tracking, and attendance logs",
    routes: ["/attendance"],
    category: "operations",
  },
  {
    key: "eod",
    label: "EOD Reports",
    description: "End-of-day work reports, logged hours, edits, and PDF exports",
    routes: ["/eod", "/reports"],
    category: "operations",
  },
  {
    key: "battalion",
    label: "Battalion Squads & Live Availability",
    description: "Cross-functional squads and live teammate presence windows",
    routes: ["/battalion"],
    category: "operations",
  },
  {
    key: "mom",
    label: "Minutes of Meeting (MOM)",
    description: "Audio/document MOM generation, editor, letterhead, stamps & sharing",
    routes: ["/mom"],
    category: "operations",
  },
  {
    key: "messages_tickets",
    label: "Messages & Support Tickets",
    description: "Direct chats, team channels, announcements, and helpdesk support tickets",
    routes: ["/messages", "/tickets"],
    category: "core",
  },
  {
    key: "vault",
    label: "Vault / Credentials",
    description: "Encrypted passwords, secrets, credentials, and secure team sharing",
    routes: ["/vault"],
    category: "core",
  },
  {
    key: "leave",
    label: "Leave Management",
    description: "Apply for casual/sick leave, manage holidays, and approve or reject requests",
    routes: ["/leave", "/holidays"],
    category: "operations",
  },
  {
    key: "companies_initiatives",
    label: "Companies & Initiatives",
    description: "Create, edit, and track portfolio companies and strategic initiatives",
    routes: ["/owner-dashboard"],
    category: "administration",
  },
  {
    key: "user_management",
    label: "User & Team Management",
    description: "Create/edit user accounts, roles, schedules, and reporting structure",
    routes: ["/team", "/roles"],
    category: "administration",
  },
  {
    key: "audit",
    label: "Audit Logs & Activity Trail",
    description: "Full portal activity trail of logins, permissions, and account changes",
    routes: ["/audit"],
    category: "administration",
  },
  {
    key: "addy_ai",
    label: "Addy AI Assistant",
    description: "In-portal AI assistant for portal guidance and quick workflow help",
    routes: [],
    category: "core",
  },
  {
    key: "settings_integrations",
    label: "Settings & Integrations",
    description: "Mail/SMTP, Teams, WhatsApp, Geofence, Portal Branding, and System Status",
    routes: ["/settings"],
    category: "administration",
  },
];

export const PORTAL_MODULE_MAP: Record<ModuleKey, PortalModuleDefinition> = PORTAL_MODULES.reduce(
  (acc, mod) => {
    acc[mod.key] = mod;
    return acc;
  },
  {} as Record<ModuleKey, PortalModuleDefinition>,
);

export function normalizeModulePermission(
  perm: Partial<ModulePermission> | undefined | null,
): ModulePermission {
  const edit = Boolean(perm?.edit);
  const view = edit ? true : Boolean(perm?.view);
  return { view, edit };
}

/**
 * Smart toggle helper implementing:
 * - Checking Edit automatically checks View
 * - Unchecking View automatically unchecks Edit
 */
export function toggleModulePermissionField(
  current: ModulePermission,
  field: "view" | "edit",
  checked: boolean,
): ModulePermission {
  if (field === "edit") {
    return checked ? { view: true, edit: true } : { view: current.view, edit: false };
  }
  return checked ? { view: true, edit: current.edit } : { view: false, edit: false };
}

export function createFullPermissionsMap(): ModulePermissionsMap {
  return MODULE_KEYS.reduce((acc, key) => {
    acc[key] = { view: true, edit: true };
    return acc;
  }, {} as ModulePermissionsMap);
}

export const DEFAULT_ADMIN_MODULE_PERMISSIONS: ModulePermissionsMap = {
  dashboard: { view: true, edit: true },
  owner_dashboard: { view: false, edit: false },
  tasks: { view: true, edit: true },
  attendance: { view: true, edit: true },
  eod: { view: true, edit: true },
  battalion: { view: true, edit: true },
  mom: { view: true, edit: true },
  messages_tickets: { view: true, edit: true },
  vault: { view: true, edit: true },
  leave: { view: true, edit: true },
  companies_initiatives: { view: false, edit: false },
  user_management: { view: true, edit: true },
  audit: { view: false, edit: false },
  addy_ai: { view: true, edit: true },
  settings_integrations: { view: true, edit: true },
};

export const DEFAULT_MEMBER_MODULE_PERMISSIONS: ModulePermissionsMap = {
  dashboard: { view: true, edit: true },
  owner_dashboard: { view: false, edit: false },
  tasks: { view: true, edit: true },
  attendance: { view: true, edit: true },
  eod: { view: true, edit: true },
  battalion: { view: true, edit: true },
  mom: { view: true, edit: true },
  messages_tickets: { view: true, edit: true },
  vault: { view: true, edit: true },
  leave: { view: true, edit: true },
  companies_initiatives: { view: false, edit: false },
  user_management: { view: false, edit: false },
  audit: { view: false, edit: false },
  addy_ai: { view: true, edit: true },
  settings_integrations: { view: true, edit: true },
};

export function getDefaultPermissionsForRole(role: Role): ModulePermissionsMap {
  if (role === "super_admin") return createFullPermissionsMap();
  const base =
    role === "admin" ? DEFAULT_ADMIN_MODULE_PERMISSIONS : DEFAULT_MEMBER_MODULE_PERMISSIONS;
  return MODULE_KEYS.reduce((acc, key) => {
    acc[key] = { ...base[key] };
    return acc;
  }, {} as ModulePermissionsMap);
}

export function resolveEffectivePermissions(
  role: Role,
  roleDefaults?: Partial<Record<ModuleKey, ModulePermission>> | null,
  userOverrides?: Partial<Record<ModuleKey, ModulePermission>> | null,
): ModulePermissionsMap {
  if (role === "super_admin") {
    return createFullPermissionsMap();
  }
  const fallback = getDefaultPermissionsForRole(role);
  return MODULE_KEYS.reduce((acc, key) => {
    const override = userOverrides?.[key];
    const rolePerm = roleDefaults?.[key];
    acc[key] = normalizeModulePermission(override ?? rolePerm ?? fallback[key]);
    return acc;
  }, {} as ModulePermissionsMap);
}

const ROUTE_TO_MODULE: Record<string, ModuleKey> = {
  "/dashboard": "dashboard",
  "/leads": "dashboard",
  "/leaderboard": "dashboard",
  "/owner-dashboard": "owner_dashboard",
  "/tasks": "tasks",
  "/reviews": "tasks",
  "/attendance": "attendance",
  "/eod": "eod",
  "/reports": "eod",
  "/battalion": "battalion",
  "/mom": "mom",
  "/messages": "messages_tickets",
  "/tickets": "messages_tickets",
  "/vault": "vault",
  "/leave": "leave",
  "/holidays": "leave",
  "/team": "user_management",
  "/audit": "audit",
  "/settings": "settings_integrations",
};

export function getModuleKeyForRoute(pathname: string): ModuleKey | null {
  const clean = pathname.split("?")[0]?.replace(/\/+$/, "") || "/";
  if (ROUTE_TO_MODULE[clean]) {
    return ROUTE_TO_MODULE[clean]!;
  }
  for (const [route, modKey] of Object.entries(ROUTE_TO_MODULE)) {
    if (clean.startsWith(`${route}/`)) {
      return modKey;
    }
  }
  return null;
}

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULE_KEYS as readonly string[]).includes(value);
}
