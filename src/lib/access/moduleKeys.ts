export const MODULE_KEYS = [
  "dashboard",
  "forecast",
  "alerts",
  "entities",
  "reports_usage",
  "semaphore",
  "entity_types",
  "deadline_types",
  "usage_units",
  "usage_capture",
  "users",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const USAGE_CAPTURE_SUBMODULE_PREFIX = "usage_capture_type:";

export function defaultModulesByRole(role: string) {
  const r = String(role ?? "").toLowerCase();
  if (r === "owner" || r === "admin") return [...MODULE_KEYS];
  if (r === "member") return ["dashboard", "forecast", "alerts", "entities", "reports_usage"];
  if (r === "viewer") return ["dashboard", "forecast", "alerts", "reports_usage"];
  return ["dashboard"];
}
