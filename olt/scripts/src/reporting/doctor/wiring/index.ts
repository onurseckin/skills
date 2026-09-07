export { ENGINE_RESULT_TYPE, defectKey } from "./engine-wiring-contracts.ts";
export type {
  EngineDeclaration,
  EngineInvocation,
  EngineWiringReport,
  SourceDocument,
  WiringDefect,
  WiringDefectCondition,
} from "./engine-wiring-contracts.ts";
export { collectEngineDeclarations, collectEngineInvocations } from "./engine-wiring-inventory.ts";
export { analyzeInertness, type InertnessVerdict } from "./engine-wiring-inertness.ts";
export { ACCEPTED_ENGINE_WIRING_DEFECTS } from "./engine-wiring-baseline.ts";
export { auditEngineWiring, formatEngineWiringReport } from "./engine-wiring-audit.ts";
export { ENGINE_WIRING_SOURCE_ROOTS, loadEngineWiringDocuments } from "./engine-wiring-loader.ts";
