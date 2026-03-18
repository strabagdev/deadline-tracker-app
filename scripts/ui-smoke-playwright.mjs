import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

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
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

async function expectVisible(page, selector, label) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 15000 });
  console.log(`OK: ${label}`);
}

async function main() {
  loadEnvLocal();

  const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";
  const loginEmail = process.env.SMOKE_OWNER_EMAIL || process.env.SMOKE_SUPERADMIN_EMAIL || "";
  const loginPassword = process.env.SMOKE_OWNER_PASSWORD || process.env.SMOKE_SUPERADMIN_PASSWORD || "";

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  try {
    console.log("1) Abrir login");
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle", timeout: 30000 });
    await expectVisible(page, "h3:has-text('Entrar a Ops Ahead')", "Cabecera login");
    await expectVisible(page, "button:has-text('Entrar')", "Tab entrar");
    await expectVisible(page, "button:has-text('Crear cuenta')", "Tab crear cuenta");

    console.log("2) Cambiar a crear cuenta");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expectVisible(page, "h3:has-text('Crear cuenta de acceso')", "Cabecera crear cuenta");
    await expectVisible(page, "input#signup-email", "Campo email signup visible");
    await expectVisible(page, "input#signup-password", "Campo contraseña signup visible");

    console.log("3) Volver a entrar");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expectVisible(page, "input#password", "Campo contraseña visible");

    console.log("4) Abrir select-org sin sesión");
    await page.goto(`${baseUrl}/select-org`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    const currentUrl = page.url();
    if (!currentUrl.includes("/login") && !currentUrl.includes("/select-org")) {
      throw new Error(`Ruta inesperada al abrir /select-org sin sesión: ${currentUrl}`);
    }
    console.log(`OK: select-org resolvió a ${currentUrl}`);

    if (loginEmail && loginPassword) {
      console.log("5) Login con credenciales smoke");
      await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle", timeout: 30000 });
      await page.locator("input#email").fill(loginEmail);
      await page.locator("input#password").fill(loginPassword);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const postLoginUrl = page.url();
      if (
        !postLoginUrl.includes("/select-org") &&
        !postLoginUrl.includes("/app") &&
        !postLoginUrl.includes("/app/super-admin")
      ) {
        throw new Error(`Redirección inesperada después de login: ${postLoginUrl}`);
      }
      console.log(`OK: login redirigió a ${postLoginUrl}`);

      if (postLoginUrl.includes("/select-org")) {
        const options = [
          page.locator("h3:has-text('Estado de acceso')"),
          page.locator("h3:has-text('Elige tu organización')"),
          page.locator("h3:has-text('Resolviendo acceso')"),
        ];
        const visible = await Promise.any(
          options.map((locator) =>
            locator.waitFor({ state: "visible", timeout: 5000 }).then(() => true)
          )
        ).catch(() => false);
        if (!visible) {
          throw new Error("No se detectó el estado principal esperado en select-org");
        }
        console.log("OK: select-org mostró un estado principal válido");
      }
    } else {
      console.log("SKIP: login autenticado (faltan variables SMOKE_OWNER_* o SMOKE_SUPERADMIN_*)");
    }

    console.log("UI smoke OK");
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("UI smoke FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
