// @ts-nocheck
import { JourneyFlowEngine } from "./journey-flow.ts";
import { FormStressExplorer } from "./form-stress.ts";
import { OverlayOrchestrator } from "./overlay-orchestrator.ts";
import { ResponsiveReflowProber } from "./responsive-reflow.ts";
export class BrowserChoreographyEngine {
  public readonly journeys: JourneyFlowEngine;
  public readonly forms: FormStressExplorer;
  public readonly overlays: OverlayOrchestrator;
  public readonly responsive: ResponsiveReflowProber;

  public constructor(options?: {
    journeys?: JourneyFlowEngine;
    forms?: FormStressExplorer;
    overlays?: OverlayOrchestrator;
    responsive?: ResponsiveReflowProber;
  }) {
    this.journeys = options?.journeys ?? new JourneyFlowEngine();
    this.forms = options?.forms ?? new FormStressExplorer();
    this.overlays = options?.overlays ?? new OverlayOrchestrator();
    this.responsive = options?.responsive ?? new ResponsiveReflowProber();
  }
}

let defaultBrowserChoreographyEngine: BrowserChoreographyEngine | null = null;

export function getDefaultBrowserChoreographyEngine(): BrowserChoreographyEngine {
  if (!defaultBrowserChoreographyEngine) {
    defaultBrowserChoreographyEngine = new BrowserChoreographyEngine();
  }
  return defaultBrowserChoreographyEngine;
}

export function setDefaultBrowserChoreographyEngine(
  engine: BrowserChoreographyEngine,
): void {
  defaultBrowserChoreographyEngine = engine;
}

export function resetDefaultBrowserChoreographyEngine(): void {
  defaultBrowserChoreographyEngine = null;
}