export type {
  DefectSeverity,
  DefectStatus,
  DefectCategory,
  DefectResolutionProof,
  DefectOccurrence,
  DefectRecordInput,
  DefectEntry,
  AggregatedDefect,
  ParseDefectLogOptions,
  LiveDeduplicationOptions,
  DefectKeyOptions,
  DefectHypothesis,
  DefectRemediationAction,
} from "./types.ts";

export {
  normalizeObservationSignature,
  createFnv1aHash,
  createSha256Hash,
  createDefectContentHash,
  computeDefectDiscriminator,
  extractDefectKeywords,
  calculateDefectSimilarity,
} from "./discriminator.ts";

export {
  isRecord,
  normalizeText,
  categorizeDefect,
} from "./sanitizer.ts";
