// @ts-nocheck
import { HarnessError } from "../../core/errors/index.ts";
import type {
  MotionHeadlessPreFlightInput,
  MotionHeadlessPreFlightResult,
  TemporalKeyframeInspectionInput,
  TemporalKeyframeInspectionResult,
  FocusRingMetrics,
  FocusRingInspectionResult,
  HoverLiftMetrics,
  HoverLiftInspectionResult,
  SpringPhysicsInspectionInput,
  SpringPhysicsInspectionResult,
} from "./types.ts";
import { HeadlessMotionPreFlightAuditor } from "./preflight-auditor.ts";
import { TemporalKeyframeStepSampler } from "./sampler.ts";
import { MicrocraftInspector } from "./microcraft.ts";
export class MotionVerificationEngine {
  public readonly preFlight: HeadlessMotionPreFlightAuditor;
  public readonly temporalSampler: TemporalKeyframeStepSampler;
  public readonly microcraft: MicrocraftInspector;

  public constructor(options?: {
    preFlight?: HeadlessMotionPreFlightAuditor;
    temporalSampler?: TemporalKeyframeStepSampler;
    microcraft?: MicrocraftInspector;
  }) {
    this.preFlight = options?.preFlight ?? new HeadlessMotionPreFlightAuditor();
    this.temporalSampler =
      options?.temporalSampler ?? new TemporalKeyframeStepSampler();
    this.microcraft = options?.microcraft ?? new MicrocraftInspector();
  }
}

let defaultMotionVerificationEngine: MotionVerificationEngine | null = null;

export function getDefaultMotionVerificationEngine(): MotionVerificationEngine {
  if (!defaultMotionVerificationEngine) {
    defaultMotionVerificationEngine = new MotionVerificationEngine();
  }
  return defaultMotionVerificationEngine;
}

export function setDefaultMotionVerificationEngine(
  engine: MotionVerificationEngine,
): void {
  defaultMotionVerificationEngine = engine;
}

export function resetDefaultMotionVerificationEngine(): void {
  defaultMotionVerificationEngine = null;
}
