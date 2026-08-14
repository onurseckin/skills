import { createHash } from "node:crypto";
import { promptLines } from "./predicates.ts";

export interface PromptSource {
  digest: string;
  lines: string[];
}

export function promptSource(value: unknown): PromptSource | null {
  if (typeof value !== "string" && !(value instanceof Uint8Array)) return null;
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  return {
    digest: createHash("sha256").update(bytes).digest("hex"),
    lines: promptLines(text),
  };
}
