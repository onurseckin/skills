import { HarnessError } from "../core/errors/index.ts";
import {
  DEFAULT_REVIEW_PROTOCOL_POLICY,
  loadRepoPolicy,
  type RepoPolicy,
  type ReviewProtocolPolicy,
} from "./repo-policy.ts";
import type { AgentMetadata } from "../runtime/index.ts";
import type { Finding } from "../core/contracts/index.ts";

export interface ReviewTaskRecord {
  readonly id: string;
  readonly status?: string | undefined;
  readonly findings?: readonly Finding[] | undefined;
  readonly review_history?: readonly ReviewChannelEntry[] | undefined;
  readonly review_state?: TaskReviewState | undefined;
  readonly [key: string]: unknown;
}
export type TaskRecord = ReviewTaskRecord;

export type ReviewPhase = "adversarial" | "cognitive" | "completed";

export type ReviewChannelKind = "adversarial" | "cognitive";

export interface ReviewChannelEntry {
  readonly round: number;
  readonly channel: ReviewChannelKind;
  readonly actor_id: string;
  readonly verdict?: "pass" | "reject" | "probe" | "micro_cycle" | undefined;
  readonly findings_count?: number | undefined;
  readonly probe_demands_count?: number | undefined;
  readonly summary?: string | undefined;
  readonly timestamp: string;
}

export interface ReviewProtocolConfig {
  readonly max_adversarial_pushes: number;
  readonly cognitive_pushes: number;
  readonly escalate_on_exhausted_adversarial: boolean;
}

export const DEFAULT_REVIEW_PROTOCOL_CONFIG: ReviewProtocolConfig = {
  max_adversarial_pushes: DEFAULT_REVIEW_PROTOCOL_POLICY.max_adversarial_pushes,
  cognitive_pushes: DEFAULT_REVIEW_PROTOCOL_POLICY.cognitive_pushes,
  escalate_on_exhausted_adversarial:
    DEFAULT_REVIEW_PROTOCOL_POLICY.escalate_on_exhausted_adversarial ?? true,
};

export interface TaskReviewState {
  readonly task_id: string;
  readonly adversarial_rounds_used: number;
  readonly max_adversarial_pushes: number;
  readonly cognitive_rounds_completed: number;
  readonly cognitive_pushes_required: number;
  readonly current_phase: ReviewPhase;
  readonly can_finalize_review: boolean;
  readonly exhausted_adversarial: boolean;
  readonly history: readonly ReviewChannelEntry[];
}

export function isTaskRecord(value: unknown): value is TaskRecord {
  return typeof value === "object" && value !== null && "id" && "status" in value;
}

export function resolveReviewProtocolConfig(
  repoRootOrPolicy?: string | RepoPolicy | undefined,
  agentMetadata?: AgentMetadata | undefined,
  overrides?: Partial<ReviewProtocolPolicy> | undefined,
): ReviewProtocolConfig {
  let policyConfig: Partial<ReviewProtocolPolicy> | undefined;

  if (typeof repoRootOrPolicy === "string") {
    const policy = loadRepoPolicy(repoRootOrPolicy);
    policyConfig = policy.review_protocol;
  } else if (typeof repoRootOrPolicy === "object" && repoRootOrPolicy !== null) {
    policyConfig = repoRootOrPolicy.review_protocol;
  }

  let agentConfig: Partial<ReviewProtocolPolicy> | undefined;
  if (agentMetadata) {
    const metadata = agentMetadata.metadata;
    if (typeof metadata === "object" && metadata !== null) {
      const rec = metadata as Record<string, unknown>;
      if (typeof rec["review_config"] === "object" && rec["review_config"] !== null) {
        agentConfig = rec["review_config"] as Partial<ReviewProtocolPolicy>;
      }
    }
  }

  const mergedMaxAdv =
    overrides?.max_adversarial_pushes ??
    policyConfig?.max_adversarial_pushes ??
    agentConfig?.max_adversarial_pushes ??
    DEFAULT_REVIEW_PROTOCOL_CONFIG.max_adversarial_pushes;
  const mergedCognitive =
    overrides?.cognitive_pushes ??
    policyConfig?.cognitive_pushes ??
    agentConfig?.cognitive_pushes ??
    DEFAULT_REVIEW_PROTOCOL_CONFIG.cognitive_pushes;
  const mergedEscalate =
    overrides?.escalate_on_exhausted_adversarial ??
    policyConfig?.escalate_on_exhausted_adversarial ??
    agentConfig?.escalate_on_exhausted_adversarial ??
    DEFAULT_REVIEW_PROTOCOL_CONFIG.escalate_on_exhausted_adversarial;

  return {
    max_adversarial_pushes:
      typeof mergedMaxAdv === "number" && Number.isSafeInteger(mergedMaxAdv) && mergedMaxAdv >= 1
        ? mergedMaxAdv
        : DEFAULT_REVIEW_PROTOCOL_CONFIG.max_adversarial_pushes,
    cognitive_pushes:
      typeof mergedCognitive === "number" &&
      Number.isSafeInteger(mergedCognitive) &&
      mergedCognitive >= 0
        ? mergedCognitive
        : DEFAULT_REVIEW_PROTOCOL_CONFIG.cognitive_pushes,
    escalate_on_exhausted_adversarial: Boolean(mergedEscalate),
  };
}

export function extractReviewHistory(
  input: TaskRecord | readonly ReviewChannelEntry[],
): readonly ReviewChannelEntry[] {
  if (Array.isArray(input)) {
    return input;
  }
  const task = input as TaskRecord;
  const rawHistory = (task as Record<string, unknown>)["review_history"];
  if (Array.isArray(rawHistory)) {
    return rawHistory.filter(
      (entry): entry is ReviewChannelEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.round === "number" &&
        (entry.channel === "adversarial" || entry.channel === "cognitive"),
    );
  }
  return [];
}

export function projectTaskReviewState(
  taskOrHistory: TaskRecord | readonly ReviewChannelEntry[],
  config: ReviewProtocolConfig = DEFAULT_REVIEW_PROTOCOL_CONFIG,
): TaskReviewState {
  const isTask = isTaskRecord(taskOrHistory);
  const taskId = isTask ? taskOrHistory.id : "task-review";
  const history = extractReviewHistory(taskOrHistory);

  let adversarialRounds = 0;
  let cognitiveRounds = 0;

  for (const entry of history) {
    if (entry.channel === "adversarial") {
      adversarialRounds += 1;
    } else if (entry.channel === "cognitive") {
      cognitiveRounds += 1;
    }
  }

  if (isTask) {
    const repairRound =
      typeof taskOrHistory.repair_round === "number" ? taskOrHistory.repair_round : 0;
    const probeRound =
      typeof taskOrHistory.probe_round === "number" ? taskOrHistory.probe_round : 0;

    if (repairRound > adversarialRounds) {
      adversarialRounds = repairRound;
    }
    if (probeRound > cognitiveRounds) {
      cognitiveRounds = probeRound;
    }
  }

  const openDefects = isTask
    ? ((taskOrHistory.findings ?? []) as Finding[]).filter(
        (f) => f.status === "open" && f.kind !== "cognitive_probe",
      ).length
    : 0;

  const requiredCognitive = config.cognitive_pushes;
  const exhaustedAdversarial =
    openDefects > 0 &&
    config.escalate_on_exhausted_adversarial &&
    adversarialRounds >= config.max_adversarial_pushes;

  let currentPhase: ReviewPhase;
  if (openDefects > 0 || (adversarialRounds > 0 && openDefects > 0)) {
    currentPhase = "adversarial";
  } else if (cognitiveRounds < requiredCognitive) {
    currentPhase = "cognitive";
  } else {
    currentPhase = "completed";
  }

  const canFinalize = openDefects === 0 && cognitiveRounds >= requiredCognitive;

  return {
    task_id: taskId,
    adversarial_rounds_used: adversarialRounds,
    max_adversarial_pushes: config.max_adversarial_pushes,
    cognitive_rounds_completed: cognitiveRounds,
    cognitive_pushes_required: requiredCognitive,
    current_phase: currentPhase,
    can_finalize_review: canFinalize,
    exhausted_adversarial: exhaustedAdversarial,
    history,
  };
}

export function evaluateReviewPhase(
  input: TaskRecord | readonly ReviewChannelEntry[],
  config: ReviewProtocolConfig = DEFAULT_REVIEW_PROTOCOL_CONFIG,
): ReviewPhase {
  return projectTaskReviewState(input, config).current_phase;
}

export function canFinalizeReview(
  input: TaskRecord | readonly ReviewChannelEntry[],
  config: ReviewProtocolConfig = DEFAULT_REVIEW_PROTOCOL_CONFIG,
): boolean {
  return projectTaskReviewState(input, config).can_finalize_review;
}

export function assertReviewProtocolSatisfied(
  task: TaskRecord,
  config: ReviewProtocolConfig = DEFAULT_REVIEW_PROTOCOL_CONFIG,
  resolvedFindingIds: readonly string[] = [],
): void {
  const state = projectTaskReviewState(task, config);

  if (state.exhausted_adversarial) {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot finalize review for task '${task.id}': Maximum adversarial defect repair rounds (${config.max_adversarial_pushes}) exhausted with open findings remaining. Escalating task.`,
    );
  }

  const resolvedSet = new Set(resolvedFindingIds);
  const openFindings = (task.findings ?? []).filter(
    (f) => f.status === "open" && !resolvedSet.has(f.id),
  );
  if (openFindings.length > 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot finalize review for task '${task.id}': ${openFindings.length} open finding(s) remain unresolved.`,
    );
  }

  if (state.cognitive_rounds_completed < state.cognitive_pushes_required) {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot finalize review for task '${task.id}': Cognitive deepening protocol not satisfied. Completed ${state.cognitive_rounds_completed}/${state.cognitive_pushes_required} required cognitive rounds. Run \`task:probe --task ${task.id} --kind cognitive\` to satisfy cognitive deepening.`,
    );
  }
}

export class ReviewProtocolEngine {
  readonly config: ReviewProtocolConfig;

  constructor(config?: Partial<ReviewProtocolConfig> | undefined) {
    this.config = resolveReviewProtocolConfig(undefined, undefined, config);
  }

  projectState(taskOrHistory: TaskRecord | readonly ReviewChannelEntry[]): TaskReviewState {
    return projectTaskReviewState(taskOrHistory, this.config);
  }

  evaluatePhase(taskOrHistory: TaskRecord | readonly ReviewChannelEntry[]): ReviewPhase {
    return evaluateReviewPhase(taskOrHistory, this.config);
  }

  canFinalize(taskOrHistory: TaskRecord | readonly ReviewChannelEntry[]): boolean {
    return canFinalizeReview(taskOrHistory, this.config);
  }

  assertSatisfied(task: TaskRecord): void {
    assertReviewProtocolSatisfied(task, this.config);
  }

  recordEntry(
    task: TaskRecord,
    entry: Omit<ReviewChannelEntry, "timestamp"> & { timestamp?: string },
  ): ReviewChannelEntry {
    const timestamp = entry.timestamp ?? new Date().toISOString();
    const channelEntry: ReviewChannelEntry = {
      round: entry.round,
      channel: entry.channel,
      actor_id: entry.actor_id,
      ...(entry.verdict !== undefined ? { verdict: entry.verdict } : {}),
      ...(entry.findings_count !== undefined ? { findings_count: entry.findings_count } : {}),
      ...(entry.probe_demands_count !== undefined
        ? { probe_demands_count: entry.probe_demands_count }
        : {}),
      ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
      timestamp,
    };

    const record = task as Record<string, unknown>;
    const existingHistory = Array.isArray(record["review_history"])
      ? (record["review_history"] as ReviewChannelEntry[])
      : [];
    const updatedHistory = [...existingHistory, channelEntry];
    record["review_history"] = updatedHistory;
    record["review_state"] = projectTaskReviewState(task, this.config);

    return channelEntry;
  }
}
