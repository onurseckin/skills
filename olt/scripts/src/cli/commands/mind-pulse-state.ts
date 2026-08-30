import type { SupervisoryPersonaReminder } from "../../authority/supervisory/index.ts";
import type { CliDiagnosticReceipt, ScriptBackedDiagnosticsResult } from "../../engine/scheduler/index.ts";
import type {
  MindPulseActiveAgentCoordinate,
  MindPulseWaveLaneInfo,
  MindPulseWorkSpanMetrics,
} from "./mind-pulse-metrics.ts";

export const CLOSING_FORBIDDEN_FOR_MIND = "CLOSING_FORBIDDEN_FOR_MIND" as const;

export interface MindPulseTelemetryBudget {
  readonly pulses_today: number;
  readonly pulses_per_day: number | null;
  readonly wall_clock_ms_today?: number | undefined;
  readonly wall_clock_ms_per_day?: number | null | undefined;
}

export interface MindPulseResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly pulse_id: string;
  readonly status: "active" | "opened";
  readonly action: "telemetry" | "opened";
  readonly actor: string;
  readonly host: string;
  readonly driver: string;
  readonly opened_at: string;
  readonly deadline_at: string;
  readonly scheduled_interval_ms: number;
  readonly next_wake_at: string;
  readonly cadence: "infinite_autonomous";
  readonly closing_permitted: false;
  readonly invariant: typeof CLOSING_FORBIDDEN_FOR_MIND;
  readonly budget: MindPulseTelemetryBudget;
  readonly zero_value_streak?: number | undefined;
  readonly persona_reminder?: SupervisoryPersonaReminder | undefined;
  readonly work_span?: MindPulseWorkSpanMetrics | undefined;
  readonly active_agents?: readonly MindPulseActiveAgentCoordinate[] | undefined;
  readonly wave_lanes?: readonly MindPulseWaveLaneInfo[] | undefined;
  readonly cli_receipts?: readonly CliDiagnosticReceipt[] | undefined;
  readonly cli_receipt_summary_badge?: string | undefined;
  readonly dag_badges?: readonly string[] | undefined;
  readonly diagnostics?: ScriptBackedDiagnosticsResult | undefined;
  readonly [key: string]: unknown;
}
