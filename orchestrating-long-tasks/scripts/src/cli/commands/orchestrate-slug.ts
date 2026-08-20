import { RUN_ID_PATTERN } from "../../store/constants.ts";

// A slug this long already carries the words a human needs to recognise the run; anything past it
// is copied prompt text bloating a directory name, not a useful identifier.
const MAX_WORDS = 6;
const MAX_WORDS_LENGTH = 48;

/**
 * Derives a run id from the prompt so `orchestrate` needs no `--run` flag for the common case.
 * The id is a naming convenience, never a fact about the run, so collapsing punctuation or
 * truncating long prompts here does not touch the honesty rule that governs recorded values.
 */
export function deriveRunId(promptText: string, today: Date = new Date()): string {
  const words = promptText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  const datePrefix = today.toISOString().slice(0, 10);
  const wordsPart = words
    .join("-")
    .slice(0, MAX_WORDS_LENGTH)
    .replace(/-+$/u, "");
  const base = wordsPart.length > 0 ? `${datePrefix}-${wordsPart}` : datePrefix;
  // RUN_ID_PATTERN requires an alnum start and end; the date prefix always satisfies the start,
  // and the trailing-hyphen strip above already satisfies the end for a non-empty words part.
  if (!RUN_ID_PATTERN.test(base)) return datePrefix;
  return base;
}

/**
 * Appends the smallest numeric suffix that clears `isTaken`, so an auto-derived id never collides
 * with a run someone already started today under the same words. An explicit `--run` the caller
 * chose is never suffixed here — colliding with a name the caller picked is their call, not ours.
 */
export function firstAvailableRunId(base: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`could not find an available run id derived from ${base}`);
}
