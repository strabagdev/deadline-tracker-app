import { createDataServerClient } from "@/lib/supabase/dataServer";

type DataClient = ReturnType<typeof createDataServerClient>;

export type SemaphoreSettings = {
  yellowDays: number;
  orangeDays: number;
  redDays: number;
  labelGreen: string;
  labelYellow: string;
  labelOrange: string;
  labelRed: string;
};

const DEFAULT_SETTINGS: SemaphoreSettings = {
  yellowDays: 60,
  orangeDays: 30,
  redDays: 15,
  labelGreen: "Al día",
  labelYellow: "Aviso",
  labelOrange: "Por vencer",
  labelRed: "Vencido",
};

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: unknown; message?: unknown; details?: unknown };
  if (String(maybe.code ?? "") === "42703") return true;
  const text = `${String(maybe.message ?? "")} ${String(maybe.details ?? "")}`.toLowerCase();
  return text.includes("does not exist");
}

export async function getSemaphoreSettings(db: DataClient, organizationId: string): Promise<SemaphoreSettings> {
  const { data, error } = await db
    .from("organization_settings")
    .select("yellow_days, orange_days, red_days, label_green, label_yellow, label_orange, label_red")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error && !isMissingColumnError(error)) throw error;

  if (!error) {
    return {
      yellowDays: Number(data?.yellow_days ?? DEFAULT_SETTINGS.yellowDays),
      orangeDays: Number(data?.orange_days ?? DEFAULT_SETTINGS.orangeDays),
      redDays: Number(data?.red_days ?? DEFAULT_SETTINGS.redDays),
      labelGreen: String(data?.label_green ?? DEFAULT_SETTINGS.labelGreen),
      labelYellow: String(data?.label_yellow ?? DEFAULT_SETTINGS.labelYellow),
      labelOrange: String(data?.label_orange ?? DEFAULT_SETTINGS.labelOrange),
      labelRed: String(data?.label_red ?? DEFAULT_SETTINGS.labelRed),
    };
  }

  const { data: legacyData, error: legacyErr } = await db
    .from("organization_settings")
    .select(
      "yellow_days, orange_days, red_days, date_yellow_days, date_orange_days, date_red_days, usage_yellow_days, usage_orange_days, usage_red_days"
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (legacyErr && !isMissingColumnError(legacyErr)) throw legacyErr;

  return {
    yellowDays: Number(
      legacyData?.yellow_days ??
        legacyData?.date_yellow_days ??
        legacyData?.usage_yellow_days ??
        DEFAULT_SETTINGS.yellowDays
    ),
    orangeDays: Number(
      legacyData?.orange_days ??
        legacyData?.date_orange_days ??
        legacyData?.usage_orange_days ??
        DEFAULT_SETTINGS.orangeDays
    ),
    redDays: Number(
      legacyData?.red_days ??
        legacyData?.date_red_days ??
        legacyData?.usage_red_days ??
        DEFAULT_SETTINGS.redDays
    ),
    labelGreen: DEFAULT_SETTINGS.labelGreen,
    labelYellow: DEFAULT_SETTINGS.labelYellow,
    labelOrange: DEFAULT_SETTINGS.labelOrange,
    labelRed: DEFAULT_SETTINGS.labelRed,
  };
}
