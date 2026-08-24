import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { resolveQuotaDagSnapshotPath } from "../core/shared/paths.ts";
import { emitTelemetryEvent } from "../reporting/telemetry-stream.ts";
import type { CircuitBreakerEvaluation } from "./circuit-breaker.ts";

export interface QuotaDagSnapshotTask {
  id: string;
  status: string;
  effortMath: string;
  agent?: string;
  dependencies: string[];
}

export interface QuotaDagSnapshotAgent {
  id: string;
  role: string;
  status: string;
}

export interface QuotaDagSnapshotWave {
  waveId: string;
  status: string;
  lanes: string[];
}

export interface QuotaDagSnapshotCron {
  cronId: string;
  expression: string;
  purpose: string;
}

export interface QuotaDagSnapshot {
  version: string;
  frozenAt: string;
  resumedAt?: string;
  status: "frozen" | "resumed";
  activeWave?: QuotaDagSnapshotWave;
  tasks: QuotaDagSnapshotTask[];
  agents: QuotaDagSnapshotAgent[];
  cronsSuspended: QuotaDagSnapshotCron[];
  uncommittedFiles: string[];
  lowestQuotaObserved: number;
  constrainedModels: string[];
  autoWakeSchedule: {
    resetTime: string;
    resumeTime: string;
  };
}

export interface CaptureDagSnapshotOptions {
  runRoot?: string | undefined;
  lowestQuotaObserved: number;
  constrainedModels: string[];
  resetTime: string;
}

export interface ResumeDagSnapshotOptions {
  repoRoot?: string | undefined;
  customPath?: string | undefined;
  clearAfterResume?: boolean | undefined;
}

export interface ResumeDagSnapshotResult {
  restoredWaveLanes: string[];
  cronsToReRegister: QuotaDagSnapshotCron[];
  resumeDirectives: string[];
}

export const DEFAULT_QUOTA_SNAPSHOT_FILENAME = "quota-dag-snapshot.json";

export const STANDARD_SUPERVISORY_CRONS: QuotaDagSnapshotCron[] = [
  { cronId: "mind-pulse", expression: "*/5 * * * *", purpose: "Mind pulse" },
  { cronId: "mind-auditor-live", expression: "*/3 * * * *", purpose: "Mind Auditor live" },
  { cronId: "skill-auditor-live", expression: "*/3 * * * *", purpose: "Skill Auditor live" },
  { cronId: "orchestrator-cadence", expression: "*/5 * * * *", purpose: "Orchestrator cadence" },
];

export async function captureDagSnapshot(
  options: CaptureDagSnapshotOptions,
): Promise<QuotaDagSnapshot> {
  const tasks: QuotaDagSnapshotTask[] = [];
  const agents: QuotaDagSnapshotAgent[] = [];
  let activeWave: QuotaDagSnapshotWave | undefined;

  const runRoot = options.runRoot;

  if (runRoot && existsSync(runRoot)) {
    const memoryPath = join(runRoot, "memory.json");
    if (existsSync(memoryPath)) {
      try {
        const rawMemData = readFileSync(memoryPath, "utf-8");
        const parsedData = JSON.parse(rawMemData) as unknown;

        if (parsedData && typeof parsedData === "object") {
          const memData = parsedData as Record<string, unknown>;

          if (Array.isArray(memData["tasks"])) {
            for (const t of memData["tasks"]) {
              if (t && typeof t === "object") {
                const taskObj = t as Record<string, unknown>;
                const task: QuotaDagSnapshotTask = {
                  id: typeof taskObj["id"] === "string" ? taskObj["id"] : "unknown",
                  status: typeof taskObj["status"] === "string" ? taskObj["status"] : "pending",
                  effortMath:
                    typeof taskObj["effortMath"] === "string" ? taskObj["effortMath"] : "1 Work",
                  dependencies: Array.isArray(taskObj["dependencies"])
                    ? (taskObj["dependencies"] as unknown[]).map(String)
                    : [],
                };
                if (typeof taskObj["agent"] === "string") {
                  task.agent = taskObj["agent"];
                }
                tasks.push(task);
              }
            }
          }

          if (Array.isArray(memData["agents"])) {
            for (const a of memData["agents"]) {
              if (a && typeof a === "object") {
                const agentObj = a as Record<string, unknown>;
                agents.push({
                  id: typeof agentObj["id"] === "string" ? agentObj["id"] : "unknown",
                  role: typeof agentObj["role"] === "string" ? agentObj["role"] : "worker",
                  status: typeof agentObj["status"] === "string" ? agentObj["status"] : "idle",
                });
              }
            }
          }

          if (memData["activeWave"] && typeof memData["activeWave"] === "object") {
            const waveObj = memData["activeWave"] as Record<string, unknown>;
            activeWave = {
              waveId: typeof waveObj["waveId"] === "string" ? waveObj["waveId"] : "unknown",
              status: typeof waveObj["status"] === "string" ? waveObj["status"] : "active",
              lanes: Array.isArray(waveObj["lanes"])
                ? (waveObj["lanes"] as unknown[]).map(String)
                : [],
            };
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  }

  let uncommittedFiles: string[] = [];
  try {
    const gitOutput = execSync("git status --porcelain", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd: runRoot || process.cwd(),
    });
    uncommittedFiles = gitOutput
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim());
  } catch {
    // Ignore git errors
  }

  const resetDate = new Date();
  const resumeDate = new Date(resetDate.getTime() + 60 * 1000);

  const snapshot: QuotaDagSnapshot = {
    version: "1.0.0",
    frozenAt: new Date().toISOString(),
    status: "frozen",
    tasks,
    agents,
    cronsSuspended: STANDARD_SUPERVISORY_CRONS,
    uncommittedFiles,
    lowestQuotaObserved: 0, // Injected via evaluation below in caller, or left as 0 here
    constrainedModels: [],
    autoWakeSchedule: {
      resetTime: resetDate.toISOString(),
      resumeTime: resumeDate.toISOString(),
    },
  };

  if (activeWave) {
    snapshot.activeWave = activeWave;
  }
  return snapshot;
}

export function persistDagSnapshot(
  snapshot: QuotaDagSnapshot,
  options?: { repo?: string },
): string {
  const path = resolveQuotaDagSnapshotPath(options?.repo);
  writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf-8");

  emitTelemetryEvent(
    {
      timestamp: new Date().toISOString(),
      actor: "system",
      action: "QUOTA_FREEZE_SNAPSHOT",
      status: "success",
      details: {
        frozenAt: snapshot.frozenAt,
        lowestQuotaObserved: snapshot.lowestQuotaObserved,
        constrainedModels: snapshot.constrainedModels,
      },
    },
    options?.repo,
  );

  return path;
}

export function loadDagSnapshot(repoRoot?: string, customPath?: string): QuotaDagSnapshot | null {
  const path = resolveQuotaDagSnapshotPath(repoRoot, customPath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as QuotaDagSnapshot;
  } catch {
    return null;
  }
}

export async function resumeDagSnapshot(
  options?: ResumeDagSnapshotOptions,
): Promise<ResumeDagSnapshotResult> {
  const snapshot = loadDagSnapshot(options?.repoRoot, options?.customPath);
  if (!snapshot) {
    return {
      restoredWaveLanes: [],
      cronsToReRegister: [],
      resumeDirectives: [],
    };
  }

  snapshot.status = "resumed";
  snapshot.resumedAt = new Date().toISOString();

  const cronsToReRegister = snapshot.cronsSuspended || [];
  const restoredWaveLanes = snapshot.activeWave?.lanes || [];
  const resumeDirectives = [
    `Re-register crons: ${cronsToReRegister.map((c) => c.cronId).join(", ")}`,
    `Resume wave lanes: ${restoredWaveLanes.join(", ")}`,
  ];

  const path = resolveQuotaDagSnapshotPath(options?.repoRoot, options?.customPath);
  if (options?.clearAfterResume) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } else {
    writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf-8");
  }

  emitTelemetryEvent(
    {
      timestamp: new Date().toISOString(),
      actor: "system",
      action: "QUOTA_RESUME_SNAPSHOT",
      status: "success",
      details: {
        resumedAt: snapshot.resumedAt,
        frozenAt: snapshot.frozenAt,
      },
    },
    options?.repoRoot,
    options?.customPath,
  );

  return {
    restoredWaveLanes,
    cronsToReRegister,
    resumeDirectives,
  };
}

export function formatDagSnapshotMarkdown(
  snapshot: QuotaDagSnapshot,
  evaluation: CircuitBreakerEvaluation,
  detailed = false,
): string {
  let md = `## Quota DAG Snapshot\n\n`;
  md += `- **Status**: ${snapshot.status}\n`;
  md += `- **Frozen At**: ${snapshot.frozenAt}\n`;
  md += `- **Lowest Quota Observed**: ${evaluation.lowestRemainingQuota !== null ? evaluation.lowestRemainingQuota : "None"}%\n`;
  md += `- **Constrained Models**: ${evaluation.constrainedModels.map((m) => m.modelName).join(", ") || "None"}\n`;
  md += `- **Auto-Wake Resume Time**: ${snapshot.autoWakeSchedule.resumeTime}\n\n`;

  if (detailed) {
    md += `### Tasks\n`;
    if (snapshot.tasks.length === 0) md += `*No active tasks*\n`;
    for (const t of snapshot.tasks) {
      md += `- **${t.id}**: ${t.status} (Effort: ${t.effortMath})\n`;
    }
    md += `\n### Uncommitted Files\n`;
    if (snapshot.uncommittedFiles.length === 0) md += `*None*\n`;
    for (const f of snapshot.uncommittedFiles) {
      md += `- \`${f}\`\n`;
    }
  }
  return md;
}

export function formatDagResumeMarkdown(result: ResumeDagSnapshotResult, detailed = false): string {
  let md = `## DAG Resume State\n\n`;
  md += `### Restored Wave Lanes\n`;
  if (result.restoredWaveLanes.length === 0) md += `*None*\n`;
  for (const l of result.restoredWaveLanes) {
    md += `- ${l}\n`;
  }
  md += `\n### Crons to Re-Register\n`;
  if (result.cronsToReRegister.length === 0) md += `*None*\n`;
  for (const c of result.cronsToReRegister) {
    md += `- **${c.cronId}**: \`${c.expression}\` (${c.purpose})\n`;
  }

  if (detailed && result.resumeDirectives.length > 0) {
    md += `\n### Directives\n`;
    for (const d of result.resumeDirectives) {
      md += `- ${d}\n`;
    }
  }

  return md;
}
