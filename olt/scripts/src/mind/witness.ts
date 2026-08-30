export type {
  WitnessResolution,
  DefectWitnessVerification,
  CommandStatus,
  CommandRecord,
} from "./auditing/witness/index.ts";

export {
  resolveWitnessCommand,
  collectCapsuleSearchRoots,
  readCommandOutput,
  verifyDefectWitness,
} from "./auditing/witness/index.ts";
