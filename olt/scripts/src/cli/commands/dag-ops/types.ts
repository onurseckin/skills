import type { DagCheckResult, DagHealResult } from "../../../engine/dag/index.ts";

export interface DagCommandFlags {
  readonly [key: string]: string | boolean | number | undefined;
  readonly run?: string;
  readonly "run-id"?: string;
  readonly repo?: string;
  readonly plan?: string;
  readonly mode?: "prune" | "invert";
  readonly "dry-run"?: boolean;
  readonly json?: boolean;
  readonly detailed?: boolean;
}

export interface DagCheckCommandResult extends Record<string, unknown> {
  readonly ok: boolean;
  readonly markdown: string;
  readonly result: DagCheckResult;
}

export interface DagHealCommandResult extends Record<string, unknown> {
  readonly ok: boolean;
  readonly markdown: string;
  readonly result: DagHealResult;
}
