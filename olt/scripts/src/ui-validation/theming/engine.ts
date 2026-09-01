// @ts-nocheck
import { PermutationGridManager } from "./permutation-grid.ts";
import { MathematicalContrastPreFilter } from "./contrast-prefilter.ts";
import { ThematicGateVerifier } from "./thematic-gate.ts";
import {
  detectThemeFlash,
  calibrateDarkDepth,
  validateHighContrastBoundaries,
} from "./theming-detectors.ts";
export class PermutationStagingEngine {
  public readonly gridManager: PermutationGridManager;
  public readonly preFilter: MathematicalContrastPreFilter;
  public readonly thematicGate: ThematicGateVerifier;

  public constructor(options?: {
    gridManager?: PermutationGridManager;
    preFilter?: MathematicalContrastPreFilter;
    thematicGate?: ThematicGateVerifier;
  }) {
    this.gridManager = options?.gridManager ?? new PermutationGridManager();
    this.preFilter = options?.preFilter ?? new MathematicalContrastPreFilter();
    this.thematicGate = options?.thematicGate ?? new ThematicGateVerifier();
  }
}

let defaultPermutationStagingEngine: PermutationStagingEngine | null = null;

export function getDefaultPermutationStagingEngine(): PermutationStagingEngine {
  if (!defaultPermutationStagingEngine) {
    defaultPermutationStagingEngine = new PermutationStagingEngine();
  }
  return defaultPermutationStagingEngine;
}

export function setDefaultPermutationStagingEngine(engine: PermutationStagingEngine): void {
  defaultPermutationStagingEngine = engine;
}

export function resetDefaultPermutationStagingEngine(): void {
  defaultPermutationStagingEngine = null;
}
