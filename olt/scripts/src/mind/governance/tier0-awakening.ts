import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import { registerSessionGrant } from "../../authority/session/grants.ts";
import type { RepoEcosystem, RepoPolicy } from "../../policy/types/index.ts";
import { inspectToolchainDetails } from "./toolchain-inspector.ts";
import { testToolchainEmpirically, type EmpiricalToolchainReport } from "./empirical-tester.ts";
import {
  discoverAndCalibrateRepoPolicy,
  ensureCalibratedRepoPolicy,
  isRepoPolicyCalibrated,
  scaffoldTailoredPolicy,
} from "./policy-coverage.ts";

export interface RepoGovernanceStatus {
  readonly olt_dir: string;
  readonly policy_path: string;
  readonly backlog_path: string;
  readonly defects_path: string;
  readonly session_path: string;
  readonly ready: boolean;
}

export interface BootstrapRepoGovernanceOptions {
  readonly repoRoot: string;
  readonly runRoot: string;
  readonly mindId: string;
}

export interface Tier0AwakeningResult {
  readonly status: "awakened" | "ready";
  readonly repoRoot: string;
  readonly policyPath: string;
  readonly policy: RepoPolicy;
  readonly governance: RepoGovernanceStatus;
  readonly awakenedAgents: readonly AgentGrantRecord[];
  readonly empiricalReport: EmpiricalToolchainReport;
  readonly ready: boolean;
}

export function createTier0AgentGrants(
  mindId: string,
  options?: { host?: string | undefined; now?: string | undefined },
): AgentGrantRecord[] {
  const nowIso = options?.now !== undefined ? options.now : new Date().toISOString();
  const host = options?.host !== undefined ? options.host : "initialization";
  return [
    {
      id: mindId,
      role: "mind",
      parent_agent_id: null,
      parent_task_id: null,
      host,
      granted_at: nowIso,
      status: "active",
    },
    {
      id: `${mindId}-mind-auditor`,
      role: "mind-auditor",
      parent_agent_id: mindId,
      parent_task_id: null,
      host,
      granted_at: nowIso,
      status: "active",
    },
    {
      id: `${mindId}-skill-auditor`,
      role: "skill-auditor",
      parent_agent_id: mindId,
      parent_task_id: null,
      host,
      granted_at: nowIso,
      status: "active",
    },
  ];
}

function safeAtomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, filePath);
  } catch {
    writeFileSync(filePath, content, "utf8");
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function withAdvisoryLock<T>(lockPath: string, fn: () => T, maxRetries = 10): T {
  let acquired = false;
  for (let i = 0; i < maxRetries; i++) {
    try {
      writeFileSync(lockPath, `${process.pid}:${Date.now()}`, { flag: "wx" });
      acquired = true;
      break;
    } catch {
      if (existsSync(lockPath)) {
        try {
          const raw = readFileSync(lockPath, "utf8").trim();
          const [pidStr, tsStr] = raw.split(":");
          const pid = pidStr ? parseInt(pidStr, 10) : NaN;
          const ts = tsStr ? parseInt(tsStr, 10) : NaN;
          const isStaleByAge = !isNaN(ts) && Date.now() - ts > 10000;
          const isDeadProcess = !isNaN(pid) && !isProcessAlive(pid);

          if (isStaleByAge || isDeadProcess) {
            unlinkSync(lockPath);
            continue;
          }
        } catch {}
      }
      const now = Date.now();
      while (Date.now() - now < 5) {}
    }
  }

  try {
    return fn();
  } finally {
    if (acquired) {
      try {
        unlinkSync(lockPath);
      } catch {}
    }
  }
}

function syncAgentLedger(runRoot: string, newGrants: readonly AgentGrantRecord[]): void {
  if (runRoot.length === 0) return;
  if (!existsSync(runRoot)) {
    mkdirSync(runRoot, { recursive: true });
  }

  const lockPath = join(runRoot, ".agents.lock");
  withAdvisoryLock(lockPath, () => {
    const agentLedgerPath = join(runRoot, "agents.jsonl");
    const existingMap = new Map<string, AgentGrantRecord>();

    if (existsSync(agentLedgerPath)) {
      try {
        const content = readFileSync(agentLedgerPath, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            const parsed = JSON.parse(trimmed) as AgentGrantRecord;
            if (parsed && typeof parsed.id === "string") {
              existingMap.set(parsed.id, parsed);
            }
          }
        }
      } catch {}
    }

    for (const grant of newGrants) {
      existingMap.set(grant.id, grant);
    }

    const lines =
      Array.from(existingMap.values())
        .map((g) => JSON.stringify(g))
        .join("\n") + "\n";
    safeAtomicWrite(agentLedgerPath, lines);
  });
}

export function initializeGovernance(
  options: BootstrapRepoGovernanceOptions,
): RepoGovernanceStatus {
  const root = resolve(options.repoRoot);
  const oltDir = join(root, ".olt");
  if (!existsSync(oltDir)) {
    mkdirSync(oltDir, { recursive: true });
  }

  const policyPath = join(oltDir, "policy.json");
  const isCalibrated = isRepoPolicyCalibrated(root);
  if (!existsSync(policyPath) || !isCalibrated) {
    discoverAndCalibrateRepoPolicy(root);
  }

  const backlogPath = join(oltDir, "backlog.jsonl");
  if (!existsSync(backlogPath)) {
    safeAtomicWrite(backlogPath, "");
  }

  const defectsPath = join(oltDir, "defects.jsonl");
  if (!existsSync(defectsPath)) {
    safeAtomicWrite(defectsPath, "");
  }

  const sessionPath = join(root, ".session.json");
  if (!existsSync(sessionPath)) {
    const grant = registerSessionGrant({
      agentId: options.mindId,
      role: "mind",
      runRoot: options.runRoot,
      worktreeDir: root,
    });
    safeAtomicWrite(sessionPath, JSON.stringify(grant, null, 2));
  }

  const ready =
    existsSync(oltDir) &&
    existsSync(policyPath) &&
    existsSync(backlogPath) &&
    existsSync(defectsPath) &&
    existsSync(sessionPath);

  return {
    olt_dir: oltDir,
    policy_path: policyPath,
    backlog_path: backlogPath,
    defects_path: defectsPath,
    session_path: sessionPath,
    ready,
  };
}

export function awakenTier0Governance(
  options: BootstrapRepoGovernanceOptions & {
    testCommands?: boolean | undefined;
    overrideEcosystem?: RepoEcosystem | undefined;
  },
): Tier0AwakeningResult {
  const root = resolve(options.repoRoot);
  const details = inspectToolchainDetails(root);

  const empiricalReport =
    options.testCommands !== false
      ? testToolchainEmpirically(root, details)
      : { repoRoot: root, verifiedCommands: [], passed: true };

  let policy: RepoPolicy;
  if (options.overrideEcosystem !== undefined) {
    policy = scaffoldTailoredPolicy(root, {
      overrideEcosystem: options.overrideEcosystem,
    });
  } else {
    policy = ensureCalibratedRepoPolicy(root);
  }
  const oltDir = join(root, ".olt");
  const policyPath = join(oltDir, "policy.json");

  const governance = initializeGovernance(options);

  const nowIso = new Date().toISOString();
  const awakenedAgents = createTier0AgentGrants(options.mindId, {
    host: "initialization",
    now: nowIso,
  });

  if (options.runRoot.length > 0) {
    try {
      syncAgentLedger(options.runRoot, awakenedAgents);
    } catch {}
  }

  const isReady = governance.ready && existsSync(policyPath) && awakenedAgents.length === 3;

  return {
    status: "awakened",
    repoRoot: root,
    policyPath,
    policy,
    governance,
    awakenedAgents,
    empiricalReport,
    ready: isReady,
  };
}
