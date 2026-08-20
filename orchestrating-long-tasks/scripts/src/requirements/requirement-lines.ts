import { HarnessError } from "../errors/harness-error.ts";
import { promptLines } from "./prompt-lines.ts";

const TOKEN_PATTERN = /^(\d{1,9})(?:-(\d{1,9}))?$/u;

function reject(message: string): never {
  throw new HarnessError("INVALID_ARGUMENT", `--requirement-lines ${message}`);
}

/**
 * Parses `3-5,8` into ascending unique prompt line numbers.
 *
 * The lines are checked against the prompt at declaration time rather than at compile time because
 * a requirement bound to a blank or out-of-range line produces a `source_excerpt` the requirements
 * validator rejects as an INTEGRITY failure — a failure that would otherwise surface long after the
 * mistake, attributed to the wrong command.
 */
export function parseRequirementLines(spec: string, prompt: string): number[] {
  const lines = promptLines(prompt);
  const numbers = new Set<number>();
  for (const part of spec.split(",")) {
    const token = part.trim();
    const match = TOKEN_PATTERN.exec(token);
    if (!match) reject(`expects line numbers or ranges like "3-5", got "${token}"`);
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (end < start) reject(`range "${token}" ends before it starts`);
    // Bounds are checked before the range is expanded: "1-999999999" is a plausible typo, and
    // materialising it first costs gigabytes of Set entries before the rejection it was always
    // going to get.
    if (start < 1) reject(`references line ${start}, outside the ${lines.length}-line prompt`);
    if (end > lines.length) {
      const firstOutside = Math.max(start, lines.length + 1);
      reject(`references line ${firstOutside}, outside the ${lines.length}-line prompt`);
    }
    for (let line = start; line <= end; line += 1) numbers.add(line);
  }
  if (numbers.size === 0) reject("must name at least one prompt line");
  const ordered = [...numbers].sort((left, right) => left - right);
  for (const line of ordered) {
    if (!lines[line - 1]!.trim()) reject(`references blank prompt line ${line}`);
  }
  return ordered;
}
