import type { DomainCategory, RawBacklogItem } from "../index.ts";

export type IntentDomain =
  | "UI/UX"
  | "Backend/API"
  | "Core Engine"
  | "Testing"
  | "Tooling"
  | "Docs"
  | "Architecture";

export type IntentCategory =
  | "FEATURE"
  | "BUG_FIX"
  | "REFACTOR"
  | "UX_POLISH"
  | "TESTING"
  | "INFRASTRUCTURE";

export interface UserIntentRecord {
  readonly intentId: string;
  readonly snapshotId: string;
  readonly title: string;
  readonly statement: string;
  readonly rationale: string;
  readonly category: IntentCategory;
  readonly domain: IntentDomain;
  readonly canonicalDomain: DomainCategory;
  readonly priority: "P1";
  readonly primarySymbolsAffected: readonly string[];
  readonly suggestedAcceptanceCriteria: readonly string[];
  readonly writeScope: readonly string[];
  readonly suggestedTestScope: readonly string[];
  readonly sourceFiles: readonly string[];
  readonly extractedAt: string;
  readonly confidence: number;
  readonly rawSummary: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface PriorityOneDeliverable {
  readonly deliverableId: string;
  readonly intentId: string;
  readonly title: string;
  readonly priority: "P1";
  readonly category: IntentCategory;
  readonly domain: IntentDomain;
  readonly canonicalDomain: DomainCategory;
  readonly description: string;
  readonly rationale: string;
  readonly assignedScope: readonly string[];
  readonly testScope: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly backlogItem: RawBacklogItem;
  readonly createdAt: string;
}

export type RoadmapAction = "CREATE_EXPEDITED_PLAN" | "APPEND_DELIVERABLE" | "UPDATE_CLUSTER";

export interface UserIntentRoadmapIntegration {
  readonly intent: UserIntentRecord;
  readonly deliverable: PriorityOneDeliverable;
  readonly roadmapAction: RoadmapAction;
  readonly targetPlanPath?: string | undefined;
  readonly clusterId?: string | undefined;
  readonly integratedAt: string;
  readonly notes: readonly string[];
}

export interface IntentExtractionOptions {
  readonly explicitDomain?: IntentDomain | undefined;
  readonly explicitCategory?: IntentCategory | undefined;
  readonly titleHint?: string | undefined;
  readonly contextDescription?: string | undefined;
  readonly customMetadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface BacklogOptions {
  readonly planPathPrefix?: string | undefined;
  readonly createdTimestamp?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}

export function toCanonicalDomainCategory(domain: IntentDomain): DomainCategory {
  switch (domain) {
    case "UI/UX":
      return "reporting";
    case "Backend/API":
      return "engine";
    case "Core Engine":
      return "engine";
    case "Testing":
      return "validation";
    case "Tooling":
      return "tooling";
    case "Docs":
      return "reporting";
    case "Architecture":
      return "core";
  }
}
