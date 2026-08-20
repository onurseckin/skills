import type { JsonObject, JsonValue } from "./json.ts";

export type CaptureAssurance = "recorded-unverified" | "source-verified";
export type CaptureMode = "file" | "stdin" | "argv" | "verbatim_context_copy";
export type BunCompatibility = "same-major-not-older";

export interface Manifest extends JsonObject {
  schema: "harness.manifest";
  version: number;
  run_id: string;
  capsule_id: string;
  prompt_sha256: string;
  prompt_bytes: number;
  capture_mode: CaptureMode;
  source_verified: boolean;
  assurance: CaptureAssurance;
  created_at?: string;
  runtime_sha256?: string;
  runtime_files?: number;
  runtime_entrypoint?: string;
  bun_version: string;
  bun_compatibility?: BunCompatibility;
  runtime_version: string;
}

export interface RunState extends JsonObject {
  schema: "harness.state";
  version: number;
  revision: number;
  event_sequence: number;
  event_head: null | string;
}

export interface HarnessEvent extends JsonObject {
  schema: "harness.event";
  version: number;
  run_id: string;
  capsule_id: string;
  sequence: number;
  revision: number;
  timestamp: string;
  actor: string;
  kind: string;
  payload: JsonObject;
  previous_hash: null | string;
  projection: RunState;
  hash: string;
}

export interface RunFiles {
  runRoot: string;
  manifest: Manifest;
  prompt: Uint8Array;
  state: RunState;
  events: readonly HarnessEvent[];
}

export type StateMutator = (draft: RunState) => void;
export type IntegrityIssue = { code: string; message: string; path?: string; detail?: JsonValue };
