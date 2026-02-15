type ClassDictionary = Record<string, boolean | null | undefined>;
type ClassInput = string | number | null | undefined | boolean | ClassDictionary | ClassInput[];

function toClassName(value: ClassInput): string {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(toClassName).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key)
      .join(" ");
  }
  return "";
}

export function cn(...inputs: ClassInput[]) {
  return inputs.map(toClassName).filter(Boolean).join(" ");
}
