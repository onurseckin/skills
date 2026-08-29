/**
 * Shared Leaf Contracts for Mind Lifecycle, Rounds & Cadence
 */

export interface MindPulseStatus {
  readonly generation: number;
  readonly pulseTimestamp: string;
  readonly status: "active" | "quiesced" | "halted" | "reclaiming";
  readonly lane?: string | undefined;
}

export interface GenerationGrant {
  readonly generation: number;
  readonly grantedAt: string;
  readonly expiresAt: string;
  readonly grantToken: string;
}

export interface MindBudgetOverrides {
  readonly maxDailyTokens?: number | undefined;
  readonly maxConcurrentAgents?: number | undefined;
  readonly maxDailyPulses?: number | undefined;
}

export interface MindBudget {
  readonly maxDailyTokens: number;
  readonly maxConcurrentAgents: number;
  readonly maxDailyPulses: number;
}

export interface CharterConfig {
  readonly name: string;
  readonly mission: string;
  readonly budget: MindBudget;
  readonly goals: readonly string[];
  readonly boundaries: readonly string[];
}
