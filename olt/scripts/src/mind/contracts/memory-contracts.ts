/**
 * Shared Leaf Contracts for Cognitive Memory & Briefs
 */

export interface MindMemoryEntry {
  readonly id: string;
  readonly key: string;
  readonly value: unknown;
  readonly category: string;
  readonly timestamp: string;
  readonly tags?: readonly string[] | undefined;
}

export interface CognitiveMemory {
  readonly schemaVersion: string;
  readonly entries: readonly MindMemoryEntry[];
  readonly updatedAt: string;
}

export interface MemoryDigest {
  readonly digestId: string;
  readonly generatedAt: string;
  readonly keyInsights: readonly string[];
  readonly activePatterns: readonly string[];
}

export interface WakeBrief {
  readonly wakeTimestamp: string;
  readonly pulseGeneration: number;
  readonly activeLanes: readonly string[];
  readonly pendingProposalsCount: number;
  readonly summary: string;
}
