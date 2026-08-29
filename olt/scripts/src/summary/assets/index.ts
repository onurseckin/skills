export { extractFindingScreenshots } from "./asset-mapper-finding-screenshots.ts";

export type { FindingDetailsOptions } from "./asset-mapper-findings.ts";
export { mapFindingDetails } from "./asset-mapper-findings.ts";

export {
  extractMediaPaths,
  getMimeTypeForUrl,
  inferAssetProps,
  isImageExtension,
} from "./asset-mapper-props.ts";

export type { AssetSink, IndexProvider } from "./asset-mapper-task-sources.ts";
export {
  collectCriticEvidenceAssets,
  collectFindingAssets,
  collectReportAssets,
  collectValidationAssets,
} from "./asset-mapper-task-sources.ts";

export type { AssetMapOptions, AssetScope } from "./asset-mapper.ts";
export { mapMediaAssets, mapRunScreenshotAssets } from "./asset-mapper.ts";

export type { AssetMeasurement } from "./asset-measure.ts";
export { measureAssets, measureCapsuleAsset, readHeader } from "./asset-measure.ts";
