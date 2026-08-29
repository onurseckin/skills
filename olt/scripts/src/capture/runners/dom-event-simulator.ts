export {
  DOM_EVENT_DISPATCH_SCRIPT,
  DEFAULT_DOM_SIMULATION_OPTIONS,
  DomEventSimulator,
  buildSyntheticInteractionPlan,
  classifyLayoutShift,
  resolveDomSimulationOptions,
  simulateDomEvent,
} from "./dom-event-simulator/index.ts";

export type {
  DomEventSimulationReport,
  DomEventStepResult,
  DomSimulationOptions,
  ExpectedShiftBehavior,
  ResolvedDomSimulationOptions,
  SyntheticDomEvent,
  SyntheticDomEventType,
  UnexpectedShiftDefect,
} from "./dom-event-simulator/index.ts";
