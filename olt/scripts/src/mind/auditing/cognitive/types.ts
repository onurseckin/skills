import type { ForensicsIncident } from "../meta/index.ts";
import type { StagnationTelemetry } from "../../../authority/verbatim-role-injector.ts";

export interface AuditorCursor {
  readonly lastInspectedTimestamp: string;
  readonly lastInspectedEventIndex: number;
  readonly lastAuditTimestamp?: string | undefined;
  readonly lastStagnationSignature?: string | undefined;
}

export interface MindAuditLiveResult {
  readonly stagnant: boolean;
  readonly idleDurationSeconds: number;
  readonly telemetry: StagnationTelemetry;
  readonly remediation: "deploy_mind" | "reconcile_native_mind" | "wake_mind" | "none";
  readonly injectionPrompt?: string | undefined;
  readonly defectCreated?: boolean | undefined;
  readonly localDefectCount: number;
  readonly cursor: AuditorCursor;
  readonly timestamp: string;
}

export interface SkillAuditLiveResult {
  readonly compliant: boolean;
  readonly incidents: readonly ForensicsIncident[];
  readonly defectsLogged: number;
  readonly interjectionsSent?: number | undefined;
  readonly cursor: AuditorCursor;
  readonly eventsAnalyzed: number;
  readonly timestamp: string;
}

export interface StoredAuditorCursors {
  readonly mind?: AuditorCursor | undefined;
  readonly skill?: AuditorCursor | undefined;
}
