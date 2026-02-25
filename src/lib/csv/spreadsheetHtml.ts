import { parseCsv } from "@/lib/csv/simpleCsv";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function csvToSpreadsheetHtml(csvText: string, title = "Entidades"): string {
  const rows = parseCsv(csvText);
  const tableRows = rows
    .map((row, rowIdx) => {
      const tag = rowIdx === 0 ? "th" : "td";
      const cells = row.map((cell) => `<${tag}>${escapeHtml(String(cell ?? ""))}</${tag}>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <title>${escapeHtml(title)}</title>
    <style>
      table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 4px 6px; text-align: left; white-space: nowrap; }
      th { background: #f8fafc; font-weight: 600; }
    </style>
  </head>
  <body>
    <table>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </body>
</html>`;
}

