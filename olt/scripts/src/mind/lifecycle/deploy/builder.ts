import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isAgentRole, type AgentRole } from "../../../core/contracts/index.ts";
import { evidenced, type Evidenced } from "../../../core/contracts/index.ts";
import { canonicalJsonBytes } from "../../../core/json.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { DEFAULT_PROHIBITIONS, type MindBudget, type ParsedCharter } from "../charter/index.ts";
import type { CandidateRecord } from "../../proposals/gates/index.ts";
import {
  loadRoleContract,
  parseRoleContract,
  type RoleContract,
} from "../../../packets/role-contract.ts";
import {
  ROLE_TIER_MAP,
  ALLOWED_TIER_SPAWNS,
  ABSTRACT_PROFILES,
  PROHIBITED_MODEL_PATTERNS,
  PROHIBITED_TELEMETRY_KEYS,
  validateTierSpawn,
  assertTierSpawn,
  validateAbstractProfile,
  assertAbstractProfile,
  type AbstractProfile,
  type TierSpawnValidationResult,
} from "./types.ts";

/**
 * Asserts that a deployment packet or metadata object contains 0 model names, tiers, or thinking levels.
 * Skips the prohibitions field since the prohibitions text lists protected process names.
 */
export function assertNoModelTelemetry(
  record: Record<string, unknown>,
  ignoreKeys: ReadonlySet<string> = new Set(["prohibitions", "markdown"]),
): void {
  for (const [key, value] of Object.entries(record)) {
    if (PROHIBITED_TELEMETRY_KEYS.has(key)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `packet contains prohibited telemetry field "${key}"; tier deployment packets must carry 0 model telemetry`,
      );
    }
    if (ignoreKeys.has(key)) {
      continue;
    }
    if (typeof value === "string") {
      for (const pattern of PROHIBITED_MODEL_PATTERNS) {
        if (pattern.test(value)) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `packet field "${key}" contains concrete model name matching ${pattern.toString()}: "${value}"`,
          );
        }
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      assertNoModelTelemetry(value as Record<string, unknown>, ignoreKeys);
    }
  }
}

export interface Tier1DeploymentPacketInput {
  readonly runId: string;
  readonly agentId: string;
  readonly candidateStatement: string;
  readonly witnessCommandId: string;
  readonly charterGoalIds: readonly string[];
  readonly remainingRoundBudget: number;
  readonly remainingWallClockBudgetMs: number;
  readonly profile?: string;
  readonly prohibitions?: string;
  readonly roleContractSha256?: string;
}

export interface Tier1DeploymentPacket {
  readonly schema: "harness.tier1-deployment-packet";
  readonly version: 1;
  readonly role: "orchestrator";
  readonly agent_id: string;
  readonly run_id: string;
  readonly objective: Evidenced<string>;
  readonly witness_command_id: Evidenced<string>;
  readonly charter_goal_ids: Evidenced<readonly string[]>;
  readonly round_budget: Evidenced<number>;
  readonly wall_clock_budget: Evidenced<number>;
  readonly profile: Evidenced<string>;
  readonly prohibitions: Evidenced<string>;
  readonly role_contract_sha256?: string;
  readonly packet_sha256: string;
  readonly markdown: string;
}

export function resolveOrchestratorContractSha256(): string {
  try {
    const contract = loadRoleContract("orchestrator");
    return contract.sha256;
  } catch {
    return "";
  }
}

/**
 * Constructs and validates a Tier 1 Deployment Packet per PLAN.md §3.4.
 *
 * Stamped fields and evidence classes:
 * - objective: agent_reported (the admitted candidate's statement)
 * - witness_command_id: harness_observed (the command proving the defect exists)
 * - charter_goal_ids: harness_observed (charter goals that admitted it)
 * - round_budget: derived (remaining pulse/day round budget)
 * - wall_clock_budget: derived (remaining pulse/day wall clock budget)
 * - profile: agent_reported (abstract profile name only — never a model name)
 * - prohibitions: harness_observed (the charter's never-unattended list verbatim)
 */
export function buildTier1DeploymentPacket(
  input: Tier1DeploymentPacketInput,
): Tier1DeploymentPacket {
  if (typeof input.runId !== "string" || input.runId.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", "runId must be a non-empty string");
  }
  if (typeof input.agentId !== "string" || input.agentId.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  if (typeof input.candidateStatement !== "string" || input.candidateStatement.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", "candidateStatement must be a non-empty string");
  }
  if (typeof input.witnessCommandId !== "string" || input.witnessCommandId.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", "witnessCommandId must be a non-empty string");
  }
  if (!Array.isArray(input.charterGoalIds) || input.charterGoalIds.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charterGoalIds must be a non-empty array of strings",
    );
  }
  if (
    typeof input.remainingRoundBudget !== "number" ||
    !Number.isSafeInteger(input.remainingRoundBudget) ||
    input.remainingRoundBudget < 1
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "remainingRoundBudget must be a positive integer (>= 1)",
    );
  }
  if (
    typeof input.remainingWallClockBudgetMs !== "number" ||
    !Number.isFinite(input.remainingWallClockBudgetMs) ||
    input.remainingWallClockBudgetMs < 1
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "remainingWallClockBudgetMs must be a positive number (>= 1)",
    );
  }

  const profileName = (input.profile ?? "deliberate").trim();
  assertAbstractProfile(profileName);

  const prohibitionsText = (input.prohibitions ?? DEFAULT_PROHIBITIONS).trim();
  const contractSha = input.roleContractSha256 ?? resolveOrchestratorContractSha256();

  const objectiveEv = evidenced(input.candidateStatement.trim(), "agent_reported");
  const witnessEv = evidenced(input.witnessCommandId.trim(), "harness_observed");
  const goalsEv = evidenced([...input.charterGoalIds], "harness_observed");
  const roundBudgetEv = evidenced(input.remainingRoundBudget, "derived");
  const wallClockBudgetEv = evidenced(input.remainingWallClockBudgetMs, "derived");
  const profileEv = evidenced(profileName, "agent_reported");
  const prohibitionsEv = evidenced(prohibitionsText, "harness_observed");

  const markdownLines: string[] = [
    `# Tier 1 Deployment Packet — Orchestrator (${input.agentId})`,
    "",
    "## Objective",
    "",
    objectiveEv.value,
    "",
    "## Witness Command",
    "",
    `\`${witnessEv.value}\``,
    "",
    "## Charter Goal IDs",
    "",
    ...goalsEv.value.map((id) => `- \`${id}\``),
    "",
    "## Budgets",
    "",
    `- **Round budget**: ${roundBudgetEv.value}`,
    `- **Wall-clock budget**: ${wallClockBudgetEv.value} ms`,
    "",
    "## Abstract Profile",
    "",
    `\`${profileEv.value}\``,
    "",
    "## Prohibitions",
    "",
    prohibitionsEv.value,
    "",
  ];
  const markdown = markdownLines.join("\n");

  const canonicalPayload = {
    schema: "harness.tier1-deployment-packet" as const,
    version: 1 as const,
    role: "orchestrator" as const,
    agent_id: input.agentId,
    run_id: input.runId,
    objective: objectiveEv,
    witness_command_id: witnessEv,
    charter_goal_ids: goalsEv,
    round_budget: roundBudgetEv,
    wall_clock_budget: wallClockBudgetEv,
    profile: profileEv,
    prohibitions: prohibitionsEv,
    ...(contractSha !== "" ? { role_contract_sha256: contractSha } : {}),
  };

  const digest = createHash("sha256").update(canonicalJsonBytes(canonicalPayload)).digest("hex");

  const packet: Tier1DeploymentPacket = {
    ...canonicalPayload,
    packet_sha256: digest,
    markdown,
  };

  // Integrity assertion: packet contains strictly 0 model names or thinking levels
  assertNoModelTelemetry(packet as unknown as Record<string, unknown>);

  return packet;
}

/**
 * Creates Tier 1 deployment packet input from an admitted candidate and mind budget state.
 */
export function createTier1DeployInputFromCandidate(
  candidate: CandidateRecord,
  charter: ParsedCharter,
  budget: MindBudget,
  runId: string,
  agentId: string,
  options: {
    readonly profile?: string;
    readonly spentRoundsToday?: number;
    readonly spentWallClockMsToday?: number;
  } = {},
): Tier1DeploymentPacketInput {
  if (candidate.status !== "admitted") {
    throw new HarnessError(
      "INVALID_STATE",
      `candidate ${candidate.id} has status "${candidate.status}"; only admitted candidates may be deployed`,
    );
  }
  if (!candidate.witness_command_id) {
    throw new HarnessError(
      "INVALID_STATE",
      `candidate ${candidate.id} has no recorded witness_command_id; cannot deploy Tier 1 packet without witness`,
    );
  }

  const goalIds = candidate.charter_goal_ids ?? candidate.charter_goals ?? charter.goalIds;
  if (!goalIds || goalIds.length === 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `candidate ${candidate.id} cites no charter goals; cannot deploy Tier 1 packet without goal binding`,
    );
  }

  const spentRounds = options.spentRoundsToday ?? budget.pulses_today ?? 0;
  const maxRounds = budget.max_rounds_per_objective ?? 3;
  const remainingRounds = Math.max(1, maxRounds);

  const spentWallClock = options.spentWallClockMsToday ?? budget.wall_clock_ms_today ?? 0;
  const totalWallClock = budget.wall_clock_ms_per_day ?? 21_600_000;
  const remainingWallClock = Math.max(60_000, totalWallClock - spentWallClock);

  return {
    runId,
    agentId,
    candidateStatement: candidate.statement,
    witnessCommandId: candidate.witness_command_id,
    charterGoalIds: goalIds,
    remainingRoundBudget: remainingRounds,
    remainingWallClockBudgetMs: remainingWallClock,
    profile: options.profile ?? "deliberate",
    prohibitions: charter.prohibitions ?? DEFAULT_PROHIBITIONS,
  };
}
