export { STORE_LAYOUT_ARTIFACTS_SUITES } from "./artifacts/index.ts";
export { STORE_LAYOUT_HIERARCHY_SUITES } from "./hierarchy/index.ts";

export const STORE_LAYOUT_SUITES = [
  "layout-json",
  "layout-reports",
  "layout-packets",
  "layout-packets-content",
  "layout-commands",
  "layout-capture-integrity",
  "layout",
  "paths",
  "layout-integrity",
  "storage-hierarchy",
] as const;
