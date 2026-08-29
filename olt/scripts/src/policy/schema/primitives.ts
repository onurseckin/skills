import { HarnessError } from "../../core/errors/index.ts";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function integrity(p: string, m: string): never {
  throw new HarnessError("INTEGRITY", `Repo policy ${p}: ${m}`);
}

export function invalidArg(p: string, m: string): never {
  throw new HarnessError("INVALID_ARGUMENT", `Repo policy ${p}: ${m}`);
}

export function reqString(v: unknown, p: string): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    integrity(p, "must be a non-empty string");
  }
  return v.trim();
}

export function reqInt(v: unknown, p: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) {
    integrity(p, `must be an integer in [${min}, ${max}]`);
  }
  return v;
}

export function reqBool(v: unknown, p: string): boolean {
  if (typeof v !== "boolean") {
    integrity(p, "must be a boolean");
  }
  return v;
}

export function assertAllowedKeys(
  raw: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  mode: "integrity" | "invalid_argument" = "integrity",
): void {
  for (const k of Object.keys(raw)) {
    if (!allowed.has(k)) {
      if (mode === "invalid_argument") {
        invalidArg(path, `unknown top-level key '${k}'`);
      } else {
        integrity(`${path}.${k}`, "is not a supported policy field");
      }
    }
  }
}
