type PgLikeError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
};

export function isDuplicateEntityNameError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const pg = error as PgLikeError;
  const code = String(pg.code ?? "");
  const message = String(pg.message ?? "");
  const details = String(pg.details ?? "");
  return (
    code === "23505"
    && (message.includes("entities_org_type_name_unique") || details.includes("entities_org_type_name_unique"))
  );
}

export function buildDuplicateEntityNameMessage(name: string): string {
  const safeName = String(name ?? "").trim();
  return safeName
    ? `Ya existe una entidad con el nombre "${safeName}" dentro de este tipo.`
    : "Ya existe una entidad con ese nombre dentro de este tipo.";
}
