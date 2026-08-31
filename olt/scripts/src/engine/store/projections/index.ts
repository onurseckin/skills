export {
  applyArrayPatchOperation,
  diffArrayElements,
  isMonotonicArrayAppend,
  type ArrayPatchOperation,
} from "./array-patch.ts";

export {
  BRAINSTORMING_PATH,
  BRAINSTORMING_SCHEMA,
  BRAINSTORMING_VERSION,
  brainstormingProjection,
  materializeProjections,
  materializedProjectionDigests,
  materializedProjections,
  type MaterializedProjection,
} from "./materialized-projections.ts";

export { applyProjectionPatch, diffProjection, reduceEventStream } from "./projection-patch.ts";
