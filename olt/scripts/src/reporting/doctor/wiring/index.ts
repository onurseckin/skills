export { ENGINE_RESULT_TYPE, defectKey } from "./engine-wiring-contracts.ts";
export type {
  ArgumentShape,
  EngineDeclaration,
  EngineInvocation,
  EngineWiringReport,
  InvocationVoidness,
  ObjectArgumentProperty,
  OptionReadSet,
  SourceDocument,
  WiringDefect,
  WiringDefectCondition,
} from "./engine-wiring-contracts.ts";
export {
  classifyArgumentVoidness,
  classifyInvocationVoidness,
  collectOptionReadSet,
} from "./engine-wiring-arguments.ts";
export { collectEngineDeclarations, collectEngineInvocations } from "./engine-wiring-inventory.ts";
export { analyzeInertness, type InertnessVerdict } from "./engine-wiring-inertness.ts";
export {
  ACCEPTED_ENGINE_WIRING_DEFECTS,
  ENGINE_WIRING_KNOWN_LIMITS,
} from "./engine-wiring-baseline.ts";
export { auditEngineWiring, formatEngineWiringReport } from "./engine-wiring-audit.ts";
export { ENGINE_WIRING_SOURCE_ROOTS, loadEngineWiringDocuments } from "./engine-wiring-loader.ts";
