import { CompositeKeyParser } from "./composite-key-parser.ts";
import { OpticalStabilityBarrier } from "./stability-barrier.ts";
import { LifecycleManager } from "./lifecycle-manager.ts";
import { VisualDeltaComparator } from "./visual-delta.ts";
export class EvidenceLifecycleEngine {
  public readonly parser = CompositeKeyParser;
  public readonly stabilityBarrier: OpticalStabilityBarrier;
  public readonly manager: LifecycleManager;
  public readonly deltaComparator: VisualDeltaComparator;

  public constructor(options?: {
    stabilityBarrier?: OpticalStabilityBarrier;
    manager?: LifecycleManager;
    deltaComparator?: VisualDeltaComparator;
  }) {
    this.stabilityBarrier =
      options?.stabilityBarrier ?? new OpticalStabilityBarrier();
    this.manager = options?.manager ?? new LifecycleManager();
    this.deltaComparator =
      options?.deltaComparator ?? new VisualDeltaComparator();
  }
}

let defaultEvidenceLifecycleEngine: EvidenceLifecycleEngine | null = null;

export function getDefaultEvidenceLifecycleEngine(): EvidenceLifecycleEngine {
  if (!defaultEvidenceLifecycleEngine) {
    defaultEvidenceLifecycleEngine = new EvidenceLifecycleEngine();
  }
  return defaultEvidenceLifecycleEngine;
}

export function setDefaultEvidenceLifecycleEngine(
  engine: EvidenceLifecycleEngine,
): void {
  defaultEvidenceLifecycleEngine = engine;
}

export function resetDefaultEvidenceLifecycleEngine(): void {
  defaultEvidenceLifecycleEngine = null;
}
