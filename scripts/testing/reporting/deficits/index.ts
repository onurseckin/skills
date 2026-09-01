export {
  classifyDeficitCategory,
  getCategoryBadge,
  type DeficitCategoryClassification,
} from "./deficit-categorizer.ts";

export {
  groupContiguousLines,
  calculateImpactPct,
  buildDeficitClusters,
  generateDeficitRoadmap,
  formatDeficitRoadmapMarkdown,
  type ContiguousLineSegment,
} from "./deficit-clustering.ts";

export type {
  DeficitCategory,
  DeficitCategoryBreakdown,
  DeficitCluster,
  DeficitRoadmap,
  DeficitClusteringOptions,
} from "./types.ts";
