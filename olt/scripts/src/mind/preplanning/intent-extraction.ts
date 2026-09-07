export type {
  BacklogOptions,
  IntentCategory,
  IntentDomain,
  IntentExtractionOptions,
  PriorityOneDeliverable,
  RoadmapAction,
  UserIntentRecord,
  UserIntentRoadmapIntegration,
} from "./inflight/index.ts";

export {
  UserIntentExtractionEngine,
  extractUserIntent,
  integrateUserIntentIntoRoadmap,
  structureUserIntentAsBacklogDeliverable,
  toCanonicalDomainCategory,
} from "./inflight/index.ts";
