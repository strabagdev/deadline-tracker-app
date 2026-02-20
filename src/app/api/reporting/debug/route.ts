import { NextResponse } from "next/server";

type DebugRow = Record<string, unknown>;

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildHtml(args: {
  endpointUrl: string;
  status: number;
  statusText: string;
  rows: DebugRow[];
  raw: unknown;
}): string {
  const { endpointUrl, status, statusText, rows, raw } = args;
  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];

  const thead =
    cols.length > 0
      ? `<thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>`
      : "<thead><tr><th>Sin columnas</th></tr></thead>";

  const tbody =
    rows.length > 0
      ? `<tbody>${rows
          .map(
            (r) =>
              `<tr>${cols
                .map((c) => `<td>${esc(r[c] == null ? "" : r[c])}</td>`)
                .join("")}</tr>`
          )
          .join("")}</tbody>`
      : "<tbody><tr><td>Sin datos</td></tr></tbody>";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reporting Debug</title>
    <style>
      body { margin: 0; padding: 24px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #f8fafc; color: #0f172a; }
      .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
      h1 { margin: 0 0 8px 0; font-size: 20px; }
      .muted { color: #475569; font-size: 14px; margin-bottom: 4px; }
      .ok { color: #166534; }
      .err { color: #b91c1c; }
      .table-wrap { overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
      table { border-collapse: collapse; width: 100%; font-size: 13px; }
      th, td { border-bottom: 1px solid #e2e8f0; text-align: left; padding: 8px 10px; white-space: nowrap; }
      th { position: sticky; top: 0; background: #f1f5f9; }
      pre { background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 12px; overflow: auto; max-height: 340px; font-size: 12px; }
      a { color: #0f766e; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Reporting Debug</h1>
      <div class="muted">Endpoint consultado: <a href="${esc(endpointUrl)}">${esc(endpointUrl)}</a></div>
      <div class="${status >= 200 && status < 300 ? "ok" : "err"}">HTTP ${esc(status)} ${esc(statusText)}</div>
      <div class="muted">Filas detectadas: ${esc(rows.length)}</div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          ${thead}
          ${tbody}
        </table>
      </div>
    </div>
    <div class="card">
      <div class="muted">JSON crudo</div>
      <pre>${esc(JSON.stringify(raw, null, 2))}</pre>
    </div>
  </body>
</html>`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = (url.searchParams.get("org_id") ?? "").trim();
  const pbiKey = (url.searchParams.get("pbi_key") ?? "").trim();
  const format = (url.searchParams.get("format") ?? "").trim().toLowerCase();

  if (!orgId || !pbiKey) {
    return NextResponse.json(
      {
        error: "org_id and pbi_key are required",
        example:
          "/api/reporting/debug?org_id=UUID&pbi_key=YOUR_KEY",
      },
      { status: 400 }
    );
  }

  const origin = url.origin;
  const reportingUrl = `${origin}/api/reporting/deadlines?org_id=${encodeURIComponent(orgId)}&pbi_key=${encodeURIComponent(
    pbiKey
  )}`;

  try {
    const res = await fetch(reportingUrl, { cache: "no-store" });
    const raw = (await res.json().catch(() => null)) as unknown;
    const rows = Array.isArray(raw) ? (raw as DebugRow[]) : [];

    if (format === "json") {
      return NextResponse.json(
        {
          endpoint: reportingUrl,
          status: res.status,
          status_text: res.statusText,
          rows_count: rows.length,
          payload: raw,
        },
        { status: res.ok ? 200 : res.status }
      );
    }

    const html = buildHtml({
      endpointUrl: reportingUrl,
      status: res.status,
      statusText: res.statusText,
      rows,
      raw,
    });

    return new NextResponse(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "debug endpoint failed" },
      { status: 500 }
    );
  }
}

