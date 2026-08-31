import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import { registerSessionGrant } from "../../authority/session/grants.ts";
import type { RepoEcosystem, RepoPolicy } from "../../policy/types/index.ts";
import {
  inspectToolchainDetails,
} from "./toolchain-inspector.ts";
import {
  testToolchainEmpirically,
  type EmpiricalToolchainReport,
} from "./empirical-tester.ts";
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
  if (!existsSync(policyPath) ? true : !isCalibrated) {
    discoverAndCalibrateRepoPolicy(root);
  }

  const backlogPath = join(oltDir, "backlog.jsonl");
  if (!existsSync(backlogPath)) {
    writeFileSync(backlogPath, "", "utf8");
  }

  const defectsPath = join(oltDir, "defects.jsonl");
  if (!existsSync(defectsPath)) {
    writeFileSync(defectsPath, "", "utf8");
  }

  const sessionPath = join(root, ".session.json");
  if (!existsSync(sessionPath)) {
    const grant = registerSessionGrant({
      agentId: options.mindId,
      role: "mind",
      runRoot: options.runRoot,
      worktreeDir: root,
    });
    writeFileSync(sessionPath, JSON.stringify(grant, null, 2), "utf8");
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

  if (options.runRoot.length > 0 && existsSync(options.runRoot)) {
    const agentLedgerPath = join(options.runRoot, "agents.jsonl");
    try {
      const lines = awakenedAgents.map((g) => JSON.stringify(g)).join("\n") + "\n";
      writeFileSync(agentLedgerPath, lines, "utf8");
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
