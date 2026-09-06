import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { TranscriptStepRecord } from "./patterns.ts";
import type { ForensicScanOptions } from "./types.ts";

export function extractConversationId(filePath: string): string {
  const match = filePath.match(/(?:brain|capsules)[/\\]([^/\\]+)/);
  if (match?.[1]) return match[1];
  const parent = basename(dirname(filePath));
  return parent === "logs" || parent === ".system_generated"
    ? basename(dirname(dirname(filePath)))
    : parent !== "." && parent !== ""
      ? parent
      : "unknown";
}

export function locateTranscripts(options?: ForensicScanOptions): string[] {
  if (options?.transcriptPath) {
    const p = resolve(options.transcriptPath);
    if (!existsSync(p)) return [];
    if (statSync(p).isFile()) return [p];
    for (const f of ["transcript.jsonl", join(".system_generated", "logs", "transcript.jsonl")]) {
      if (existsSync(join(p, f))) return [join(p, f)];
    }
    try {
      const subs = readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory());
      const res: string[] = [];
      for (const d of subs) {
        for (const sub of [
          join(p, d.name, ".system_generated", "logs", "transcript.jsonl"),
          join(p, d.name, "transcript.jsonl"),
        ]) {
          if (existsSync(sub)) {
            res.push(sub);
            break;
          }
        }
      }
      return options.limit ? res.slice(0, options.limit) : res;
    } catch {
      return [];
    }
  }
  const brainDir =
    options?.brainDirectory ?? join(homedir(), ".gemini", "antigravity-cli", "brain");
  if (!existsSync(brainDir)) return [];
  try {
    const res: string[] = [];
    for (const d of readdirSync(brainDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const cand = join(brainDir, d.name, ".system_generated", "logs", "transcript.jsonl");
      if (existsSync(cand)) res.push(cand);
    }
    return options?.limit ? res.slice(0, options.limit) : res;
  } catch {
    return [];
  }
}

export function parseTranscriptFile(filePath: string): TranscriptStepRecord[] {
  try {
    const text = readFileSync(filePath, "utf-8");
    const steps: TranscriptStepRecord[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as unknown;
        if (typeof obj === "object" && obj !== null) steps.push(obj as TranscriptStepRecord);
      } catch {
        // Skip malformed lines
      }
    }
    return steps;
  } catch {
    return [];
  }
}
