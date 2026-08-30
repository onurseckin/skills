export type {
  WitnessResolution,
  DefectWitnessVerification,
  CommandStatus,
  CommandRecord,
} from "./types.ts";

export { resolveWitnessCommand, collectCapsuleSearchRoots } from "./types.ts";

export { readCommandOutput, verifyDefectWitness } from "./verifier.ts";
