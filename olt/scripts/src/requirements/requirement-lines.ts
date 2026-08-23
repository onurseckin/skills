import { HarnessError } from "../core/errors/harness-error.ts";
import { promptLines } from "./prompt-lines.ts";

const TOKEN_PATTERN = /^(\d{1,9})(?:-(\d{1,9}))?$/u;

function reject(message: string): never {
  throw new HarnessError("INVALID_ARGUMENT", `--requirement-lines ${message}`);
}

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
