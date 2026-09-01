import { createHash, createHmac, randomUUID } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";

/**
 * The 4 Canonical Synthetic State Fixture Types
 */
export const SYNTHETIC_FIXTURE_TYPES = [
  "FULLY_POPULATED",
  "PARTIAL_TRUNCATED",
  "ZERO_RECORD_EMPTY",
  "CONTROLLED_SERVER_ERROR",
] as const;

export type SyntheticFixtureType = (typeof SYNTHETIC_FIXTURE_TYPES)[number];

/**
 * Generic Synthetic Fixture Definition
 */
export interface SyntheticFixture<T = unknown> {
  readonly type: SyntheticFixtureType;
  readonly description: string;
  readonly expectedStatusCode: number;
  readonly payload: T;
  readonly headers?: Record<string, string> | undefined;
  readonly latencyMs?: number | undefined;
}

/**
 * Schema Validation Rules
 */
export interface SchemaFieldRule {
  readonly field: string;
  readonly type: "string" | "number" | "boolean" | "array" | "object";
  readonly required?: boolean | undefined;
  readonly nullable?: boolean | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly pattern?: RegExp | string | undefined;
  readonly itemType?: "string" | "number" | "boolean" | "object" | undefined;
  readonly nestedRules?: readonly SchemaFieldRule[] | undefined;
}

export interface PayloadSchema {
  readonly name: string;
  readonly rules: readonly SchemaFieldRule[];
}

/**
 * Pre-Flight Certification Result
 */
export interface PreFlightCertificationResult {
  readonly certified: boolean;
  readonly certificateId: string;
  readonly endpoint: string;
  readonly fixtureType: SyntheticFixtureType;
  readonly statusCode: number;
  readonly expectedStatusCode: number;
  readonly schemaValid: boolean;
  readonly latencyMs: number;
  readonly violations: readonly string[];
  readonly timestamp: string;
}

/**
 * Defect Routing Receipt for Autonomous Repairer
 */
export interface RoutedDefectReceipt {
  readonly defectId: string;
  readonly recipient: "AUTONOMOUS_REPAIRER";
  readonly category: "BACKEND_DATA_LAYER_FAULT";
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  readonly endpoint: string;
  readonly fixtureType: SyntheticFixtureType;
  readonly violations: readonly string[];
  readonly statusCode: number;
  readonly payloadSnippet: string;
  readonly routedAt: string;
  readonly recommendedAction: string;
}

/**
 * Visual Foundation Handoff Token
 */
export interface VisualFoundationHandoffToken {
  readonly tokenId: string;
  readonly certificateId: string;
  readonly componentOrRoute: string;
  readonly fixtureType: SyntheticFixtureType;
  readonly payloadSha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly signature: string;
}

/**
 * Result of Handoff Token Verification
 */
export interface HandoffVerificationResult {
  readonly verified: boolean;
  readonly reason: string;
  readonly tampered: boolean;
  readonly expired: boolean;
  readonly token?: VisualFoundationHandoffToken | undefined;
}

export interface DisambiguationEvaluationResult {
  readonly endpoint: string;
  readonly componentOrRoute: string;
  readonly certification: PreFlightCertificationResult;
  readonly handoffToken?: VisualFoundationHandoffToken | undefined;
  readonly defectReceipt?: RoutedDefectReceipt | undefined;
}
