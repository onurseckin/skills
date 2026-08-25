import { HarnessError } from "../errors/harness-error.ts";
import type { ConfigValueSource, ExternallyAttestedFact } from "./provenance.ts";

export const CADENCE_WAKE_KINDS = ["timer_fired", "recovery_fired", "unknown"] as const;

export type CadenceWakeKind = (typeof CADENCE_WAKE_KINDS)[number];

export function isCadenceWakeKind(value: unknown): value is CadenceWakeKind {
  return typeof value === "string" && (CADENCE_WAKE_KINDS as readonly string[]).includes(value);
}

type MeasuredArmMechanism = "activity-recovery" | "crash-recovery";

function narrowMeasuredArmMechanism(armMechanism: string): MeasuredArmMechanism | null {
  if (armMechanism === "activity-recovery") return "activity-recovery";
  if (armMechanism === "crash-recovery") return "crash-recovery";
  return null;
}

function wakeKindForMeasuredArmMechanism(mechanism: MeasuredArmMechanism): CadenceWakeKind {
  switch (mechanism) {
    case "activity-recovery":
      return "recovery_fired";
    case "crash-recovery":
      return "recovery_fired";
  }
}

export function classifyCadenceWake(armMechanism: string | null | undefined): CadenceWakeKind {
  if (typeof armMechanism !== "string") return "unknown";
  const measured = narrowMeasuredArmMechanism(armMechanism);
  if (measured === null) return "unknown";
  return wakeKindForMeasuredArmMechanism(measured);
}

export const CADENCE_WAKE_REFERENCE_FRAMES = [
  "deadline_relative",
  "arm_relative",
  "unknown",
] as const;

export type CadenceWakeReferenceFrame = (typeof CADENCE_WAKE_REFERENCE_FRAMES)[number];

export function isCadenceWakeReferenceFrame(value: unknown): value is CadenceWakeReferenceFrame {
  return (
    typeof value === "string" &&
    (CADENCE_WAKE_REFERENCE_FRAMES as readonly string[]).includes(value)
  );
}

export interface CadenceWakeInstant {
  readonly atMs: number;
  readonly kind: CadenceWakeKind;
  readonly referenceFrame: CadenceWakeReferenceFrame;
}

export function classifyCadenceWakeInstant(input: {
  readonly atMs: number;
  readonly armMechanism?: string | null;
  readonly referenceFrame: CadenceWakeReferenceFrame;
}): CadenceWakeInstant {
  return {
    atMs: input.atMs,
    kind: classifyCadenceWake(input.armMechanism),
    referenceFrame: input.referenceFrame,
  };
}

export interface SupervisoryCadenceInput {
  readonly armIntervalSeconds: number;
  readonly armIntervalSource: ConfigValueSource;
  readonly deadlineSeconds: number;
  readonly deadlineSource: ConfigValueSource;
  readonly graceSeconds: number;
  readonly wakeDriver?: ExternallyAttestedFact<boolean>;
}

export interface SupervisoryCadence {
  readonly arm_interval_seconds: number;
  readonly arm_interval_source: ConfigValueSource;
  readonly deadline_seconds: number;
  readonly deadline_source: ConfigValueSource;
  readonly grace_seconds: number;
  readonly max_safe_arm_interval_seconds: number;
  readonly wake_driver_attested: boolean;
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `supervisory cadence ${label} must be a positive integer number of seconds, got ${value}`,
    );
  }
}

export function resolveSupervisoryCadence(input: SupervisoryCadenceInput): SupervisoryCadence {
  requirePositiveInteger(input.armIntervalSeconds, "arm interval");
  requirePositiveInteger(input.deadlineSeconds, "deadline");
  requirePositiveInteger(input.graceSeconds, "grace");

  const maxSafeArmIntervalSeconds = input.deadlineSeconds - input.graceSeconds;
  if (maxSafeArmIntervalSeconds <= 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `supervisory cadence deadline of ${input.deadlineSeconds}s leaves no safety margin once its ${input.graceSeconds}s grace is reserved; no arm interval can be safe`,
    );
  }

  if (input.armIntervalSeconds >= input.deadlineSeconds) {
    throw new HarnessError(
      "INVALID_STATE",
      `supervisory cadence arm interval ${input.armIntervalSeconds}s must be strictly less than its deadline ${input.deadlineSeconds}s; an interval that reaches the deadline guarantees a stranded pulse`,
    );
  }

  if (input.armIntervalSeconds > maxSafeArmIntervalSeconds) {
    throw new HarnessError(
      "INVALID_STATE",
      `supervisory cadence arm interval ${input.armIntervalSeconds}s exceeds the resolver-computed maximum safe interval of ${maxSafeArmIntervalSeconds}s (deadline ${input.deadlineSeconds}s minus ${input.graceSeconds}s grace); a caller-supplied interval this close to the deadline is not accepted on trust`,
    );
  }

  const wakeDriverAttested =
    input.wakeDriver !== undefined &&
    input.wakeDriver.source === "config_override" &&
    input.wakeDriver.value === true;

  return {
    arm_interval_seconds: input.armIntervalSeconds,
    arm_interval_source: input.armIntervalSource,
    deadline_seconds: input.deadlineSeconds,
    deadline_source: input.deadlineSource,
    grace_seconds: input.graceSeconds,
    max_safe_arm_interval_seconds: maxSafeArmIntervalSeconds,
    wake_driver_attested: wakeDriverAttested,
  };
}
