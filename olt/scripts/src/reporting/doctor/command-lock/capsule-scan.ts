import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "../index.ts";
import { checkCognitiveValidatorCommandLock } from "./audit.ts";

function processCapsuleDirectory(
  capDir: string,
  findings: DoctorDiagnosticFinding[],
  capsuleName?: string,
): void {
  const name = capsuleName ?? capDir;
  const statePath = join(capDir, "state.json");
  const eventsPath = join(capDir, "events.jsonl");
  let state: Record<string, unknown> | null = null;
  const events: unknown[] = [];
  if (existsSync(statePath)) {
    try {
      state = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
    } catch {
      findings.push({
        code: "COMMAND_LOCK_STATE_CORRUPT",
        severity: "ERROR",
        engine: "checkCommandLockIntegrity",
        message: `Corrupted state.json in capsule ${name}`,
        details: { capsule: name, statePath },
      });
    }
  }
  if (existsSync(eventsPath)) {
    try {
      for (const line of readFileSync(eventsPath, "utf-8").split("\n")) {
        if (line.trim().length > 0) events.push(JSON.parse(line));
      }
    } catch {}
  }
  if (state || events.length > 0) {
    findings.push(...checkCognitiveValidatorCommandLock({ state, events }).findings);
  }
}

export function checkCommandLockIntegrity(oltDir: string): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const baseDir = existsSync(oltDir) ? oltDir : join(process.cwd(), oltDir);
  const directState = join(baseDir, "state.json");
  const directEvents = join(baseDir, "events.jsonl");
  if (existsSync(directState) || existsSync(directEvents)) {
    processCapsuleDirectory(baseDir, findings);
    return {
      engine: "checkCommandLockIntegrity",
      passed: findings.filter((f) => f.severity === "ERROR").length === 0,
      findings,
    };
  }
  const capsulesDir = existsSync(join(baseDir, "capsules"))
    ? join(baseDir, "capsules")
    : existsSync(join(baseDir, ".olt", "capsules"))
      ? join(baseDir, ".olt", "capsules")
      : existsSync(join(baseDir, ".capsules"))
        ? join(baseDir, ".capsules")
        : existsSync(baseDir) && (baseDir.endsWith("capsules") || baseDir.endsWith(".capsules"))
          ? baseDir
          : join(baseDir, "capsules");
  if (existsSync(capsulesDir)) {
    try {
      for (const entry of readdirSync(capsulesDir)) {
        const capDir = join(capsulesDir, entry);
        try {
          if (!statSync(capDir).isDirectory()) continue;
          processCapsuleDirectory(capDir, findings, entry);
        } catch {}
      }
    } catch {}
  }
  return {
    engine: "checkCommandLockIntegrity",
    passed: findings.filter((f) => f.severity === "ERROR").length === 0,
    findings,
  };
}
