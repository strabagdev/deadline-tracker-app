import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function makeTempPassword() {
  return `Tmp-${crypto.randomBytes(9).toString("base64url")}9!`;
}

async function listAllAuthUsers(authAdmin) {
  const users = [];
  let page = 1;
  const perPage = 200;

  while (page <= 50) {
    const { data, error } = await authAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...(data?.users ?? []));
    if ((data?.users ?? []).length < perPage) break;
    page += 1;
  }

  return users;
}

loadEnvLocal();

const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authAdmin = db;

const [{ data: members, error: membersError }, { data: profiles, error: profilesError }] = await Promise.all([
  db.from("organization_members").select("user_id, role, organization_id"),
  db.from("profiles").select("user_id, email"),
]);
if (membersError) throw membersError;
if (profilesError) throw profilesError;

const emailByUserId = new Map((profiles ?? []).map((profile) => [String(profile.user_id), String(profile.email ?? "").trim().toLowerCase()]));
const desiredUsers = new Map();

for (const member of members ?? []) {
  const userId = String(member.user_id ?? "").trim();
  const email = emailByUserId.get(userId);
  if (!userId || !email) continue;
  if (!desiredUsers.has(email)) desiredUsers.set(email, { userId, email, roles: new Set() });
  desiredUsers.get(email).roles.add(String(member.role ?? ""));
}

const authUsers = await listAllAuthUsers(authAdmin);
const authByEmail = new Map(authUsers.map((user) => [String(user.email ?? "").trim().toLowerCase(), user]));

const results = [];

for (const desired of desiredUsers.values()) {
  const existing = authByEmail.get(desired.email);
  const password = makeTempPassword();

  if (existing?.id === desired.userId) {
    const { error } = await authAdmin.auth.admin.updateUserById(desired.userId, {
      password,
      email_confirm: true,
      user_metadata: {
        recovered_from_org_membership: true,
        recovered_at: new Date().toISOString(),
      },
    });
    if (error) throw error;
    results.push({ email: desired.email, user_id: desired.userId, action: "password_reset", temporary_password: password });
    continue;
  }

  if (existing?.id && existing.id !== desired.userId) {
    const { error } = await authAdmin.auth.admin.deleteUser(existing.id);
    if (error) throw error;
  }

  const { error } = await authAdmin.auth.admin.createUser({
    id: desired.userId,
    email: desired.email,
    password,
    email_confirm: true,
    user_metadata: {
      recovered_from_org_membership: true,
      recovered_at: new Date().toISOString(),
    },
  });
  if (error) throw error;

  results.push({
    email: desired.email,
    user_id: desired.userId,
    action: existing?.id ? "recreated_with_original_id" : "created_with_original_id",
    temporary_password: password,
  });
}

console.log(JSON.stringify({ recovered: results }, null, 2));
