export {
  DOM_EVENT_DISPATCH_SCRIPT,
  simulateDomEvent,
} from "./dispatchers.ts";

export {
  buildSyntheticInteractionPlan,
  classifyLayoutShift,
} from "./evaluator.ts";

export {
  DEFAULT_DOM_SIMULATION_OPTIONS,
  resolveDomSimulationOptions,
} from "./options.ts";

export {
  DomEventSimulator,
} from "./simulator.ts";

export type {
  DomEventSimulationReport,
  DomEventStepResult,
  DomSimulationOptions,
  ExpectedShiftBehavior,
  ResolvedDomSimulationOptions,
  SyntheticDomEvent,
  SyntheticDomEventType,
  UnexpectedShiftDefect,
} from "./types.ts";
