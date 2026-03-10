export const MODULE_KEYS = [
  "analytics_dashboard",
  "operations_dashboard",
  "forecast",
  "alerts",
  "entities",
  "reports_usage",
  "semaphore",
  "entity_types",
  "deadline_types",
  "usage_units",
  "usage_capture",
  "bi_integrations",
  "users",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
export type BaseRole = "owner" | "admin" | "member" | "viewer";

export const USAGE_CAPTURE_SUBMODULE_PREFIX = "usage_capture_type:";
export const MEMBER_TYPE_ROLE_PREFIX = "member_type_role:";

export function isBaseRole(value: string): value is BaseRole {
  return value === "owner" || value === "admin" || value === "member" || value === "viewer";
}

export function encodeMemberTypeBaseRole(role: BaseRole) {
  return `${MEMBER_TYPE_ROLE_PREFIX}${role}`;
}

export function decodeMemberTypeBaseRole(moduleKey: string): BaseRole | null {
  const raw = String(moduleKey ?? "");
  if (!raw.startsWith(MEMBER_TYPE_ROLE_PREFIX)) return null;
  const role = raw.slice(MEMBER_TYPE_ROLE_PREFIX.length);
  return isBaseRole(role) ? role : null;
}

export function inferMemberTypeBaseRole(name: string): BaseRole | null {
  const raw = String(name ?? "").trim().toLowerCase();
  return isBaseRole(raw) ? raw : null;
}

export function defaultModulesByRole(role: string) {
  const r = String(role ?? "").toLowerCase();
  if (r === "owner" || r === "admin") return [...MODULE_KEYS];
  if (r === "member") return ["analytics_dashboard", "operations_dashboard", "forecast", "alerts", "entities", "reports_usage"];
  if (r === "viewer") return ["analytics_dashboard", "operations_dashboard", "forecast", "alerts", "reports_usage"];
  return ["analytics_dashboard", "operations_dashboard"];
}
