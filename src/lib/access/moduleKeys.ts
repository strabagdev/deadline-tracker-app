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

export const USAGE_CAPTURE_SUBMODULE_PREFIX = "usage_capture_type:";

export function defaultModulesByRole(role: string) {
  const r = String(role ?? "").toLowerCase();
  if (r === "owner" || r === "admin") return [...MODULE_KEYS];
  if (r === "member") return ["analytics_dashboard", "operations_dashboard", "forecast", "alerts", "entities", "reports_usage"];
  if (r === "viewer") return ["analytics_dashboard", "operations_dashboard", "forecast", "alerts", "reports_usage"];
  return ["analytics_dashboard", "operations_dashboard"];
}
