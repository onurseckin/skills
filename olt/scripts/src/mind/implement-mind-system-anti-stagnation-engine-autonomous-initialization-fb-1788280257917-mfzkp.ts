import { createHash } from "node:crypto";

export interface MindAntiStagnationConfig {
  readonly zeroDeltaThreshold: number;
  readonly maintenanceThreshold: number;
  readonly targetCadenceSeconds: number;
  readonly enableAutonomousInit: boolean;
  readonly strikeLimit?: number | undefined;
  readonly quotaFloorPercentage?: number | undefined;
}

export interface StagnationMetrics {
  readonly synthesizedCount: number;
  readonly enqueuedCount: number;
  readonly openDefectsCount: number;
  readonly feedbackCount: number;
  readonly previousSignature?: string | undefined;
  readonly consecutiveZeroDeltas?: number | undefined;
  readonly remainingQuotaPercentage?: number | undefined;
}

export type AntiStagnationAction =
  | "continue"
  | "socratic_challenge"
  | "force_sync"
  | "suspend_quota";

export type ContainmentState = "nominal" | "strike_1" | "strike_2" | "containment";

export interface AntiStagnationEvaluation {
  readonly signature: string;
  readonly isStagnant: boolean;
  readonly zeroDeltaCycles: number;
  readonly progressiveScore: number;
  readonly actionRecommended: AntiStagnationAction;
  readonly containmentState: ContainmentState;
  readonly quotaDepleted: boolean;
  readonly remainingQuotaPercentage?: number | undefined;
}

export interface SemanticMemoryEntry {
  readonly id: string;
  readonly content: string;
  readonly epistemicStatus: "active" | "superseded" | "deprecated";
  readonly supersededBy?: string | undefined;
  readonly timestamp: string;
}

export interface ThreeTierSemanticMemory {
  readonly tier1BedrockInvariants: readonly string[];
  readonly tier2ActiveWorkingMemory: readonly string[];
  readonly tier3ArchivedEpics: readonly SemanticMemoryEntry[];
}

export interface AutonomousInitOptions {
  readonly config?: MindAntiStagnationConfig | undefined;
  readonly activeCapsules?: readonly string[] | undefined;
  readonly extraEngines?: readonly string[] | undefined;
  readonly initialBedrockInvariants?: readonly string[] | undefined;
  readonly initialWorkingMemory?: readonly string[] | undefined;
  readonly initialArchivedEpics?: readonly SemanticMemoryEntry[] | undefined;
}

export interface AutonomousInitResult {
  readonly initialized: boolean;
  readonly activeEngines: readonly string[];
  readonly initialSignature: string;
  readonly timestamp: string;
  readonly ingestedCapsules: readonly string[];
  readonly semanticMemory: ThreeTierSemanticMemory;
}

export const DEFAULT_CONFIG: MindAntiStagnationConfig = {
  zeroDeltaThreshold: 3,
  maintenanceThreshold: 3,
  targetCadenceSeconds: 60,
  enableAutonomousInit: true,
  strikeLimit: 3,
  quotaFloorPercentage: 10,
};

export const DEFAULT_BEDROCK_INVARIANTS: readonly string[] = [
  "Zero Main Thread Pollution Invariant",
  "Validator Zero Test Execution Invariant",
  "Mandatory Three-Round Socratic Dialogue Protocol",
  "Active Swarm Tailored Conversational Audit Protocol",
];

const DEFAULT_ENGINES: readonly string[] = [
  "anti-stagnation",
  "cognitive-memory",
  "pareto-arbitration",
];

const registeredEngines = new Set<string>(DEFAULT_ENGINES);

export function registerActiveEngine(engineName: string): void {
  registeredEngines.add(engineName);
}

export function unregisterActiveEngine(engineName: string): void {
  registeredEngines.delete(engineName);
}

export function resetRegisteredEngines(): void {
  registeredEngines.clear();
  for (const engine of DEFAULT_ENGINES) {
    registeredEngines.add(engine);
  }
}

export function getRegisteredEngines(): readonly string[] {
  return Array.from(registeredEngines);
}

export function computeStagnationSignature(metrics: StagnationMetrics): string {
  const parts = [
    metrics.synthesizedCount,
    metrics.enqueuedCount,
    metrics.openDefectsCount,
    metrics.feedbackCount,
  ];
  return createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 16);
}

export function evaluateAntiStagnationState(
  metrics: StagnationMetrics,
  config?: MindAntiStagnationConfig | undefined,
): AntiStagnationEvaluation {
  const cfg = config !== undefined ? config : DEFAULT_CONFIG;
  const signature = computeStagnationSignature(metrics);
  const strikeLimit = cfg.strikeLimit ?? 3;
  const quotaFloor = cfg.quotaFloorPercentage ?? 10;

  const isZeroDelta =
    metrics.previousSignature !== undefined && metrics.previousSignature === signature;
  const zeroDeltaCycles = isZeroDelta
    ? metrics.consecutiveZeroDeltas !== undefined
      ? metrics.consecutiveZeroDeltas + 1
      : 1
    : 0;

  const isStagnant = zeroDeltaCycles >= cfg.zeroDeltaThreshold || zeroDeltaCycles >= strikeLimit;

  let containmentState: ContainmentState = "nominal";
  if (zeroDeltaCycles >= strikeLimit) {
    containmentState = "containment";
  } else if (zeroDeltaCycles === 2) {
    containmentState = "strike_2";
  } else if (zeroDeltaCycles === 1) {
    containmentState = "strike_1";
  }

  const quotaDepleted =
    metrics.remainingQuotaPercentage !== undefined && metrics.remainingQuotaPercentage < quotaFloor;

  const scoreDeductions = zeroDeltaCycles * 25 + metrics.openDefectsCount * 5;
  const scoreAdditions =
    metrics.synthesizedCount * 10 + metrics.feedbackCount * 5 + metrics.enqueuedCount * 2;
  const rawScore = 100 - scoreDeductions + scoreAdditions;
  const progressiveScore = Math.max(0, Math.min(100, rawScore));

  let actionRecommended: AntiStagnationAction = "continue";
  if (quotaDepleted) {
    actionRecommended = "suspend_quota";
  } else if (isStagnant || containmentState === "containment") {
    actionRecommended = "socratic_challenge";
  } else if (metrics.openDefectsCount > 5 || metrics.openDefectsCount >= cfg.maintenanceThreshold) {
    actionRecommended = "force_sync";
  }

  return {
    signature,
    isStagnant,
    zeroDeltaCycles,
    progressiveScore,
    actionRecommended,
    containmentState,
    quotaDepleted,
    ...(metrics.remainingQuotaPercentage !== undefined
      ? { remainingQuotaPercentage: metrics.remainingQuotaPercentage }
      : {}),
  };
}

function isAutonomousInitOptions(
  val: MindAntiStagnationConfig | AutonomousInitOptions | undefined,
): val is AutonomousInitOptions {
  if (val === undefined) {
    return false;
  }
  return (
    "activeCapsules" in val ||
    "extraEngines" in val ||
    "initialBedrockInvariants" in val ||
    "initialWorkingMemory" in val ||
    "initialArchivedEpics" in val ||
    ("config" in val && !("zeroDeltaThreshold" in val))
  );
}

export function runAutonomousInitialization(
  optionsOrConfig?: MindAntiStagnationConfig | AutonomousInitOptions | undefined,
): AutonomousInitResult {
  let cfg = DEFAULT_CONFIG;
  let activeCapsules: readonly string[] = ["capsule-mind-baseline"];
  let extraEngines: readonly string[] = [];
  let bedrockInvariants = DEFAULT_BEDROCK_INVARIANTS;
  let workingMemory: readonly string[] = [];
  let archivedEpics: readonly SemanticMemoryEntry[] = [];

  if (optionsOrConfig !== undefined) {
    if (isAutonomousInitOptions(optionsOrConfig)) {
      if (optionsOrConfig.config !== undefined) {
        cfg = optionsOrConfig.config;
      }
      if (optionsOrConfig.activeCapsules !== undefined) {
        activeCapsules = optionsOrConfig.activeCapsules;
      }
      if (optionsOrConfig.extraEngines !== undefined) {
        extraEngines = optionsOrConfig.extraEngines;
      }
      if (optionsOrConfig.initialBedrockInvariants !== undefined) {
        bedrockInvariants = optionsOrConfig.initialBedrockInvariants;
      }
      if (optionsOrConfig.initialWorkingMemory !== undefined) {
        workingMemory = optionsOrConfig.initialWorkingMemory;
      }
      if (optionsOrConfig.initialArchivedEpics !== undefined) {
        archivedEpics = optionsOrConfig.initialArchivedEpics;
      }
    } else {
      cfg = optionsOrConfig;
    }
  }

  for (const engine of extraEngines) {
    registerActiveEngine(engine);
  }

  const initialMetrics: StagnationMetrics = {
    synthesizedCount: 0,
    enqueuedCount: 0,
    openDefectsCount: 0,
    feedbackCount: 0,
  };
  const initialSignature = computeStagnationSignature(initialMetrics);

  const combinedWorkingMemory = [
    ...workingMemory,
    ...activeCapsules.map((cap) => `ingested:${cap}`),
  ];

  const semanticMemory: ThreeTierSemanticMemory = {
    tier1BedrockInvariants: bedrockInvariants,
    tier2ActiveWorkingMemory: combinedWorkingMemory,
    tier3ArchivedEpics: archivedEpics,
  };

  return {
    initialized: cfg.enableAutonomousInit,
    activeEngines: getRegisteredEngines(),
    initialSignature,
    timestamp: new Date().toISOString(),
    ingestedCapsules: activeCapsules,
    semanticMemory,
  };
}
