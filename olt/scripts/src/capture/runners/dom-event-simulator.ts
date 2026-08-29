export {
  DOM_EVENT_DISPATCH_SCRIPT,
  simulateDomEvent,
  buildSyntheticInteractionPlan,
  classifyLayoutShift,
  DEFAULT_DOM_SIMULATION_OPTIONS,
  resolveDomSimulationOptions,
  DomEventSimulator,
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
