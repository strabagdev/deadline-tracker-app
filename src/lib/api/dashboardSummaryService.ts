import { createHash } from "crypto";
import { createDataServerClient } from "@/lib/supabase/dataServer";

type DataClient = ReturnType<typeof createDataServerClient>;
type RiskLevel = "green" | "yellow" | "orange" | "red" | "none";
type SummaryGenerationMode = "fallback";

type EntityRow = {
  id: string;
  name: string | null;
  tracks_usage: boolean | null;
};

type ForecastRow = {
  entity_id: string;
  deadline_id: string;
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: RiskLevel;
  computed_at: string;
};

type DeadlineRow = {
  id: string;
  deadline_type_id: string | null;
  entity_id: string;
  is_current: boolean | null;
};

type DeadlineTypeRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
};

type UsageRow = {
  entity_id: string;
  logged_on: string | null;
  logged_at: string;
};

type SummaryCacheRow = {
  organization_id: string;
  snapshot_hash: string;
  snapshot_json: DashboardSummarySnapshot;
  summary_lines: string[] | null;
  model: string | null;
  generation_mode: SummaryGenerationMode;
  updated_at: string;
  executive_comment: string | null;
  executive_comment_model: string | null;
  executive_comment_updated_at: string | null;
};

type ForecastHighlight = {
  entity_name: string;
  deadline_name: string;
  days_remaining: number | null;
};

type UsageGapHighlight = {
  entity_name: string;
  last_logged_on: string | null;
  days_since_last_log: number | null;
};

export type DashboardSummarySnapshot = {
  generated_at: string;
  organization_id: string;
  metrics: {
    total_entities: number;
    entities_with_forecast: number;
    entities_without_forecast: number;
    overdue_deadlines: number;
    due_7d_deadlines: number;
    due_30d_deadlines: number;
    entities_at_risk: number;
    usage_tracked_entities: number;
    usage_gap_entities: number;
  };
  highlights: {
    top_overdue_entities: ForecastHighlight[];
    top_upcoming_entities: ForecastHighlight[];
    top_usage_gap_entities: UsageGapHighlight[];
  };
  status: {
    overall: "stable" | "watch" | "attention";
    drivers: string[];
  };
  freshness: {
    forecast_computed_at: string | null;
    usage_gap_cutoff_days: number;
  };
};

export type DashboardSummaryTextResponse = {
  snapshot: DashboardSummarySnapshot;
  snapshot_hash: string;
  lines: string[];
  generation_mode: SummaryGenerationMode;
  model: string | null;
  updated_at: string | null;
  executive_comment: {
    text: string | null;
    model: string | null;
    updated_at: string | null;
  };
};

const USAGE_GAP_DAYS = 30;
const DEFAULT_EXECUTIVE_COMMENT_MODEL = "gpt-4o-mini";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysSinceIsoDay(isoDay: string | null, now = new Date()) {
  if (!isoDay || !/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) return null;
  const target = new Date(`${isoDay}T00:00:00Z`);
  if (!Number.isFinite(target.getTime())) return null;
  const diff = startOfUtcDay(now).getTime() - target.getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildSnapshotHash(snapshot: DashboardSummarySnapshot) {
  return createHash("sha256").update(stableSerialize(snapshot)).digest("hex");
}

function coerceLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0)
    .slice(0, 3);
}

function coerceText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function buildNarrativeBrief(snapshot: DashboardSummarySnapshot) {
  return {
    metrics: {
      overdue_deadlines: snapshot.metrics.overdue_deadlines,
      due_7d_deadlines: snapshot.metrics.due_7d_deadlines,
      due_30d_deadlines: snapshot.metrics.due_30d_deadlines,
      entities_without_forecast: snapshot.metrics.entities_without_forecast,
      usage_gap_entities: snapshot.metrics.usage_gap_entities,
    },
    focus: {
      overdue: snapshot.highlights.top_overdue_entities.slice(0, 3).map((item) => item.entity_name),
      upcoming: snapshot.highlights.top_upcoming_entities.slice(0, 3).map((item) => item.entity_name),
      usage_gap: snapshot.highlights.top_usage_gap_entities.slice(0, 3).map((item) => item.entity_name),
    },
    status: snapshot.status,
  };
}

function buildFallbackSummary(snapshot: DashboardSummarySnapshot): string[] {
  const lines: string[] = [];
  const overdue = snapshot.metrics.overdue_deadlines;
  const due7d = snapshot.metrics.due_7d_deadlines;
  const due30d = snapshot.metrics.due_30d_deadlines;
  const usageGap = snapshot.metrics.usage_gap_entities;

  if (overdue > 0 && due7d > 0) {
    lines.push(`Hay ${overdue} vencimientos atrasados y ${due7d} adicionales dentro de los próximos 7 días.`);
  } else if (overdue > 0) {
    lines.push(`Hay ${overdue} vencimientos atrasados.`);
  } else if (due7d > 0) {
    lines.push(`Hay ${due7d} vencimientos dentro de los próximos 7 días.`);
  } else if (due30d > 0) {
    lines.push(`Se proyectan ${due30d} vencimientos dentro de los próximos 30 días.`);
  } else {
    lines.push("No hay presión inmediata de vencimientos en el horizonte operativo actual.");
  }

  const focusNames = snapshot.highlights.top_overdue_entities.slice(0, 2).map((item) => item.entity_name);
  if (focusNames.length > 0) {
    lines.push(`La atención inmediata se concentra en ${focusNames.join(" y ")}.`);
  } else if (snapshot.highlights.top_upcoming_entities.length > 0) {
    lines.push(
      `Los próximos hitos recaen en ${snapshot.highlights.top_upcoming_entities
        .slice(0, 2)
        .map((item) => item.entity_name)
        .join(" y ")}.`
    );
  }

  if (usageGap > 0) {
    lines.push(`Además, ${usageGap} entidades con seguimiento de uso no registran actividad reciente.`);
  } else {
    lines.push("El seguimiento de uso reciente se encuentra cubierto en las entidades que lo requieren.");
  }

  return lines.slice(0, 3);
}

async function getSummaryCache(db: DataClient, orgId: string): Promise<SummaryCacheRow | null> {
  const { data, error } = await db
    .from("dashboard_ai_summaries")
    .select(
      "organization_id, snapshot_hash, snapshot_json, summary_lines, model, generation_mode, updated_at, executive_comment, executive_comment_model, executive_comment_updated_at"
    )
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    organization_id: String(data.organization_id),
    snapshot_hash: String(data.snapshot_hash ?? ""),
    snapshot_json: (data.snapshot_json ?? {}) as DashboardSummarySnapshot,
    summary_lines: coerceLines(data.summary_lines),
    model: data.model ? String(data.model) : null,
    generation_mode: "fallback",
    updated_at: String(data.updated_at ?? ""),
    executive_comment: coerceText(data.executive_comment),
    executive_comment_model: coerceText(data.executive_comment_model),
    executive_comment_updated_at: coerceText(data.executive_comment_updated_at),
  };
}

async function saveSummaryCache(
  db: DataClient,
  orgId: string,
  payload: {
    snapshot_hash: string;
    snapshot: DashboardSummarySnapshot;
    lines: string[];
    model: string | null;
    generation_mode: SummaryGenerationMode;
    executive_comment?: string | null;
    executive_comment_model?: string | null;
    executive_comment_updated_at?: string | null;
  }
) {
  const { data, error } = await db
    .from("dashboard_ai_summaries")
    .upsert(
      {
        organization_id: orgId,
        snapshot_hash: payload.snapshot_hash,
        snapshot_json: payload.snapshot,
        summary_lines: payload.lines,
        model: payload.model,
        generation_mode: payload.generation_mode,
        updated_at: new Date().toISOString(),
        executive_comment: payload.executive_comment ?? null,
        executive_comment_model: payload.executive_comment_model ?? null,
        executive_comment_updated_at: payload.executive_comment_updated_at ?? null,
      },
      { onConflict: "organization_id" }
    )
    .select("updated_at")
    .single();
  if (error) throw error;
  return String(data?.updated_at ?? new Date().toISOString());
}

async function generateExecutiveCommentWithOpenAI(snapshot: DashboardSummarySnapshot) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_DASHBOARD_NARRATIVE_MODEL || DEFAULT_EXECUTIVE_COMMENT_MODEL;
  const systemPrompt = [
    "Eres un analista operativo que redacta comentarios ejecutivos para una plataforma de vencimientos y uso.",
    "Usa solo el brief entregado. No inventes datos. No recalcules métricas.",
    "Redacta un único párrafo breve en español, de 2 a 4 oraciones, con tono ejecutivo y claro.",
    "Prioriza: presión actual, focos concretos y recomendación implícita de atención.",
    "No uses listas, no cites el JSON, no repitas cifras innecesariamente y no uses lenguaje promocional.",
  ].join(" ");

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 180,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Brief operativo: ${JSON.stringify(buildNarrativeBrief(snapshot))}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI error (${response.status}): ${errorText || "request_failed"}`);
  }

  const json = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = coerceText(json?.choices?.[0]?.message?.content);
  if (!content) throw new Error("OpenAI returned empty executive comment");
  return { text: content, model };
}

export async function buildDashboardSummarySnapshot(db: DataClient, orgId: string): Promise<DashboardSummarySnapshot> {
  const now = new Date();
  const nowIso = now.toISOString();
  const usageCutoffIso = new Date(now.getTime() - USAGE_GAP_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: entitiesData, error: entitiesErr } = await db
    .from("entities")
    .select("id, name, tracks_usage")
    .eq("organization_id", orgId);
  if (entitiesErr) throw entitiesErr;

  const entities = (entitiesData ?? []) as EntityRow[];
  const entityIds = entities.map((row) => row.id);
  const entityById = new Map(entities.map((row) => [row.id, row]));

  const [{ data: forecastData, error: forecastErr }, { data: deadlinesData, error: deadlinesErr }] = await Promise.all([
    entityIds.length > 0
      ? db
          .from("deadline_forecasts")
          .select("entity_id, deadline_id, forecast_due_date, days_remaining, risk_level, computed_at")
          .eq("organization_id", orgId)
          .in("entity_id", entityIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("deadlines")
      .select("id, deadline_type_id, entity_id, is_current")
      .eq("organization_id", orgId)
      .eq("is_current", true),
  ]);
  if (forecastErr) throw forecastErr;
  if (deadlinesErr) throw deadlinesErr;

  const forecasts = (forecastData ?? []) as ForecastRow[];
  const currentDeadlines = (deadlinesData ?? []) as DeadlineRow[];
  const deadlineTypeIds = Array.from(
    new Set(currentDeadlines.map((row) => String(row.deadline_type_id ?? "")).filter((value) => value.length > 0))
  );

  const { data: deadlineTypesData, error: deadlineTypesErr } = deadlineTypeIds.length
    ? await db
        .from("deadline_types")
        .select("id, name, is_active")
        .eq("organization_id", orgId)
        .in("id", deadlineTypeIds)
    : { data: [], error: null };
  if (deadlineTypesErr) throw deadlineTypesErr;

  const deadlineTypeById = new Map(
    ((deadlineTypesData ?? []) as DeadlineTypeRow[]).map((row) => [row.id, row])
  );
  const currentDeadlineIdSet = new Set(
    currentDeadlines.filter((row) => {
      const deadlineType = row.deadline_type_id ? deadlineTypeById.get(String(row.deadline_type_id)) : null;
      return deadlineType?.is_active !== false;
    }).map((row) => row.id)
  );
  const deadlineNameById = new Map(
    currentDeadlines.map((row) => [
      row.id,
      String(
        (row.deadline_type_id ? deadlineTypeById.get(String(row.deadline_type_id))?.name : null) ?? "Vencimiento"
      ),
    ])
  );

  const validForecasts = forecasts.filter((row) => currentDeadlineIdSet.has(row.deadline_id));
  const entitiesWithForecastSet = new Set(validForecasts.map((row) => row.entity_id));
  const forecastComputedAt = validForecasts.reduce<string | null>((latest, row) => {
    const current = String(row.computed_at ?? "");
    if (!current) return latest;
    if (!latest) return current;
    return current > latest ? current : latest;
  }, null);

  const nearestByEntity = new Map<string, ForecastRow>();
  for (const row of validForecasts) {
    const current = nearestByEntity.get(row.entity_id);
    const rowDays = row.days_remaining ?? Number.MAX_SAFE_INTEGER;
    const currentDays = current?.days_remaining ?? Number.MAX_SAFE_INTEGER;
    if (!current || rowDays < currentDays) {
      nearestByEntity.set(row.entity_id, row);
    }
  }

  const trackedEntities = entities.filter((row) => Boolean(row.tracks_usage));
  const trackedEntityIds = trackedEntities.map((row) => row.id);
  const latestUsageByEntity = new Map<string, UsageRow>();
  if (trackedEntityIds.length > 0) {
    const { data: usageData, error: usageErr } = await db
      .from("usage_logs")
      .select("entity_id, logged_on, logged_at")
      .eq("organization_id", orgId)
      .in("entity_id", trackedEntityIds)
      .order("entity_id", { ascending: true })
      .order("logged_on", { ascending: false })
      .order("logged_at", { ascending: false })
      .limit(100000);
    if (usageErr) throw usageErr;

    for (const row of (usageData ?? []) as UsageRow[]) {
      if (!latestUsageByEntity.has(row.entity_id)) {
        latestUsageByEntity.set(row.entity_id, row);
      }
    }
  }

  const usageGapHighlights = trackedEntities
    .map((entity) => {
      const latest = latestUsageByEntity.get(entity.id) ?? null;
      const loggedOn = latest?.logged_on ? String(latest.logged_on) : null;
      const days = daysSinceIsoDay(loggedOn, now);
      const isGap = !loggedOn || loggedOn < usageCutoffIso;
      return {
        entity_name: String(entity.name ?? "Entidad"),
        last_logged_on: loggedOn,
        days_since_last_log: days,
        is_gap: isGap,
      };
    })
    .filter((row) => row.is_gap)
    .sort((a, b) => {
      const aDays = a.days_since_last_log ?? Number.MAX_SAFE_INTEGER;
      const bDays = b.days_since_last_log ?? Number.MAX_SAFE_INTEGER;
      if (aDays !== bDays) return bDays - aDays;
      return a.entity_name.localeCompare(b.entity_name, "es", { sensitivity: "base" });
    });

  const overdueHighlights = validForecasts
    .filter((row) => (row.days_remaining ?? Number.MAX_SAFE_INTEGER) <= 0)
    .sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0))
    .slice(0, 3)
    .map((row) => ({
      entity_name: String(entityById.get(row.entity_id)?.name ?? "Entidad"),
      deadline_name: String(deadlineNameById.get(row.deadline_id) ?? "Vencimiento"),
      days_remaining: row.days_remaining != null ? Number(row.days_remaining) : null,
    }));

  const upcomingHighlights = validForecasts
    .filter((row) => {
      const days = row.days_remaining ?? Number.MAX_SAFE_INTEGER;
      return days > 0 && days <= 7;
    })
    .sort((a, b) => (a.days_remaining ?? Number.MAX_SAFE_INTEGER) - (b.days_remaining ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 3)
    .map((row) => ({
      entity_name: String(entityById.get(row.entity_id)?.name ?? "Entidad"),
      deadline_name: String(deadlineNameById.get(row.deadline_id) ?? "Vencimiento"),
      days_remaining: row.days_remaining != null ? Number(row.days_remaining) : null,
    }));

  const overdueDeadlines = validForecasts.filter((row) => (row.days_remaining ?? Number.MAX_SAFE_INTEGER) <= 0).length;
  const due7d = validForecasts.filter((row) => (row.days_remaining ?? Number.MAX_SAFE_INTEGER) <= 7).length;
  const due30d = validForecasts.filter((row) => (row.days_remaining ?? Number.MAX_SAFE_INTEGER) <= 30).length;
  const entitiesAtRisk = Array.from(nearestByEntity.values()).filter((row) => {
    return row.risk_level === "red" || row.risk_level === "orange";
  }).length;

  const drivers = [
    overdueDeadlines > 0 ? "overdue_deadlines" : null,
    usageGapHighlights.length > 0 ? "usage_gap_entities" : null,
    due7d > 0 ? "upcoming_7_days" : null,
    entitiesAtRisk > 0 ? "risk_entities" : null,
  ].filter((value): value is string => Boolean(value));

  const overall: DashboardSummarySnapshot["status"]["overall"] =
    overdueDeadlines > 0 || usageGapHighlights.length > 0
      ? "attention"
      : due7d > 0 || entitiesAtRisk > 0
        ? "watch"
        : "stable";

  return {
    generated_at: nowIso,
    organization_id: orgId,
    metrics: {
      total_entities: entities.length,
      entities_with_forecast: entitiesWithForecastSet.size,
      entities_without_forecast: Math.max(0, entities.length - entitiesWithForecastSet.size),
      overdue_deadlines: overdueDeadlines,
      due_7d_deadlines: due7d,
      due_30d_deadlines: due30d,
      entities_at_risk: entitiesAtRisk,
      usage_tracked_entities: trackedEntities.length,
      usage_gap_entities: usageGapHighlights.length,
    },
    highlights: {
      top_overdue_entities: overdueHighlights,
      top_upcoming_entities: upcomingHighlights,
      top_usage_gap_entities: usageGapHighlights.slice(0, 3).map((row) => ({
        entity_name: row.entity_name,
        last_logged_on: row.last_logged_on,
        days_since_last_log: row.days_since_last_log,
      })),
    },
    status: {
      overall,
      drivers,
    },
    freshness: {
      forecast_computed_at: forecastComputedAt,
      usage_gap_cutoff_days: USAGE_GAP_DAYS,
    },
  };
}

export async function refreshDashboardSummary(db: DataClient, orgId: string): Promise<DashboardSummaryTextResponse> {
  const snapshot = await buildDashboardSummarySnapshot(db, orgId);
  const snapshotHash = buildSnapshotHash(snapshot);
  const cached = await getSummaryCache(db, orgId);

  if (
    cached &&
    cached.snapshot_hash === snapshotHash &&
    cached.summary_lines &&
    cached.summary_lines.length > 0
  ) {
    return {
      snapshot: cached.snapshot_json,
      snapshot_hash: cached.snapshot_hash,
      lines: cached.summary_lines,
      generation_mode: "fallback",
      model: null,
      updated_at: cached.updated_at,
      executive_comment: {
        text: cached.executive_comment,
        model: cached.executive_comment_model,
        updated_at: cached.executive_comment_updated_at,
      },
    };
  }

  const lines = buildFallbackSummary(snapshot);
  let executiveComment = cached?.executive_comment ?? null;
  let executiveCommentModel = cached?.executive_comment_model ?? null;
  let executiveCommentUpdatedAt = cached?.executive_comment_updated_at ?? null;

  try {
    const generatedComment = await generateExecutiveCommentWithOpenAI(snapshot);
    if (generatedComment) {
      executiveComment = generatedComment.text;
      executiveCommentModel = generatedComment.model;
      executiveCommentUpdatedAt = new Date().toISOString();
    }
  } catch {
    // If narrative generation fails, keep the last good comment if it exists.
  }

  const updatedAt = await saveSummaryCache(db, orgId, {
    snapshot_hash: snapshotHash,
    snapshot,
    lines,
    model: null,
    generation_mode: "fallback",
    executive_comment: executiveComment,
    executive_comment_model: executiveCommentModel,
    executive_comment_updated_at: executiveCommentUpdatedAt,
  });

  return {
    snapshot,
    snapshot_hash: snapshotHash,
    lines,
    generation_mode: "fallback",
    model: null,
    updated_at: updatedAt,
    executive_comment: {
      text: executiveComment,
      model: executiveCommentModel,
      updated_at: executiveCommentUpdatedAt,
    },
  };
}
