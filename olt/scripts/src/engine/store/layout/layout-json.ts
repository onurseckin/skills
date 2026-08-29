import { isRecord } from "../../../requirements/predicates.ts";

export type JsonRecord = Record<string, unknown>;

export { isRecord };

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
