import { RUN_ID_PATTERN } from "../../engine/store/constants.ts";

const MAX_WORDS = 6;
const MAX_WORDS_LENGTH = 48;

export function deriveRunId(promptText: string, today: Date = new Date()): string {
  const words = promptText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  const datePrefix = today.toISOString().slice(0, 10);
  const wordsPart = words.join("-").slice(0, MAX_WORDS_LENGTH).replace(/-+$/u, "");
  const base = wordsPart.length > 0 ? `${datePrefix}-${wordsPart}` : datePrefix;
  if (!RUN_ID_PATTERN.test(base)) return datePrefix;
  return base;
}

export function firstAvailableRunId(base: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`could not find an available run id derived from ${base}`);
}
