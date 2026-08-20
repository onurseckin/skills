export const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isRepoRelativePath(value: unknown, allowRoot = false): value is string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/"))
    return false;
  if (value === ".") return allowRoot;
  const parts = value.split("/");
  return (
    !value.endsWith("/") && parts.every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

export function objectList(
  value: unknown,
  label: string,
  issues: string[],
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be a list`);
    return [];
  }
  const objects: Record<string, unknown>[] = [];
  value.forEach((item, index) => {
    if (isRecord(item)) objects.push(item);
    else issues.push(`${label}[${index}] must be an object`);
  });
  return objects;
}
