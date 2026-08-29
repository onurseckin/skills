export {
  ARTIFICIAL_SERIALIZATION_WARNING,
  FALSE_SERIALIZATION_DEFECT,
  type AntiSerializationInterlockResult,
  type ArtificialSerializationWarning,
  type SubagentDispatchFormatOptions,
  type SubagentDispatchItem,
} from "../parallel-decoupler/types.ts";

export {
  assertAntiSerializationInterlock,
  detectArtificialSerialization,
  verifyAntiSerializationInterlock,
} from "../parallel-decoupler/interlock.ts";
