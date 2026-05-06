import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  throw new Error(`Missing env: ${names.join(" or ")}`);
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

function assertOk(resp, step) {
  if (!resp.ok) {
    const err = resp.body?.error || `HTTP ${resp.status}`;
    const code = resp.body?.code ? ` (${resp.body.code})` : "";
    throw new Error(`${step} failed: ${err}${code}`);
  }
}

async function loginWithPassword({ authUrl, anonKey, email, password }) {
  const url = `${authUrl}/auth/v1/token?grant_type=password`;
  const res = await requestJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok || !res.body?.access_token) {
    throw new Error(`Login failed for ${email}: ${res.body?.error_description || res.body?.error || res.status}`);
  }
  return res.body.access_token;
}

async function api(baseUrl, token, route, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  return requestJson(`${baseUrl}${route}`, { ...options, headers });
}

async function main() {
  loadEnvLocal();

  const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";
  const authUrl = firstEnv("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_AUTH_URL", "NEXT_PUBLIC_DATA_SUPABASE_URL");
  const anonKey = firstEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_AUTH_ANON_KEY", "NEXT_PUBLIC_DATA_SUPABASE_ANON_KEY");

  const superAdminEmail = required("SMOKE_SUPERADMIN_EMAIL");
  const superAdminPassword = required("SMOKE_SUPERADMIN_PASSWORD");
  const ownerEmail = required("SMOKE_OWNER_EMAIL");
  const ownerPassword = required("SMOKE_OWNER_PASSWORD");

  console.log("1) Login superadmin");
  const superToken = await loginWithPassword({
    authUrl,
    anonKey,
    email: superAdminEmail,
    password: superAdminPassword,
  });

  console.log("2) Validate superadmin status");
  const superStatus = await api(baseUrl, superToken, "/api/platform/super-admin/status");
  assertOk(superStatus, "Superadmin status");
  if (!superStatus.body?.is_super_admin) {
    throw new Error("Authenticated superadmin user is not marked as super admin");
  }

  const orgName = `Smoke Org ${Date.now()}`;
  console.log("3) Create organization");
  const createOrg = await api(baseUrl, superToken, "/api/platform/admin/orgs/create", {
    method: "POST",
    body: JSON.stringify({ organizationName: orgName }),
  });
  assertOk(createOrg, "Create organization");
  const organizationId = createOrg.body?.organization?.id;
  if (!organizationId) throw new Error("Create organization returned no id");

  console.log("4) Assign owner to organization");
  const assignOwner = await api(baseUrl, superToken, "/api/platform/admin/orgs", {
    method: "PUT",
    body: JSON.stringify({ organizationId, ownerEmail }),
  });
  assertOk(assignOwner, "Assign owner");

  console.log("5) Login owner");
  const ownerToken = await loginWithPassword({
    authUrl,
    anonKey,
    email: ownerEmail,
    password: ownerPassword,
  });

  console.log("6) Set active organization for owner");
  const setActive = await api(baseUrl, ownerToken, "/api/orgs/set-active", {
    method: "POST",
    body: JSON.stringify({ organizationId }),
  });
  assertOk(setActive, "Set active org");

  console.log("7) Create entity type");
  const createEntityType = await api(baseUrl, ownerToken, "/api/entity-types", {
    method: "POST",
    body: JSON.stringify({ name: `Smoke Type ${Date.now()}` }),
  });
  assertOk(createEntityType, "Create entity type");
  const entityTypeId = createEntityType.body?.entity_type?.id;
  if (!entityTypeId) throw new Error("Create entity type returned no id");

  console.log("8) Create entity");
  const createEntity = await api(baseUrl, ownerToken, "/api/entities", {
    method: "POST",
    body: JSON.stringify({
      name: `Smoke Entity ${Date.now()}`,
      entity_type_id: entityTypeId,
      tracks_usage: false,
      field_values: [],
    }),
  });
  assertOk(createEntity, "Create entity");
  const entityId = createEntity.body?.entity?.id;
  if (!entityId) throw new Error("Create entity returned no id");

  console.log("9) Create deadline type (date)");
  const createDeadlineType = await api(baseUrl, ownerToken, "/api/deadline-types", {
    method: "POST",
    body: JSON.stringify({
      name: `Smoke Deadline ${Date.now()}`,
      measure_by: "date",
      requires_document: false,
    }),
  });
  assertOk(createDeadlineType, "Create deadline type");
  const deadlineTypeId = createDeadlineType.body?.id;
  if (!deadlineTypeId) throw new Error("Create deadline type returned no id");

  const due = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log("10) Create deadline for entity");
  const createDeadline = await api(baseUrl, ownerToken, "/api/deadlines", {
    method: "POST",
    body: JSON.stringify({
      entity_id: entityId,
      deadline_type_id: deadlineTypeId,
      next_due_date: due,
    }),
  });
  assertOk(createDeadline, "Create deadline");

  console.log("11) Validate dashboard");
  const dashboard = await api(baseUrl, ownerToken, "/api/dashboard");
  assertOk(dashboard, "Dashboard");
  const entities = Array.isArray(dashboard.body?.entities) ? dashboard.body.entities : [];
  const found = entities.find((e) => e.id === entityId);
  if (!found) throw new Error("Created entity not found in dashboard");

  console.log("Smoke E2E OK");
  console.log(JSON.stringify({ organizationId, entityTypeId, entityId, deadlineTypeId }, null, 2));
}

main().catch((err) => {
  console.error("Smoke E2E FAILED");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
