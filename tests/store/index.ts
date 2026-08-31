/**
 * @file index.ts
 * Root Facade for Store domain
 */

export { STORE_CAPSULE_SUITES } from "./capsule/index.ts";
export { STORE_CONTENT_NORMALIZATION_SUITES } from "./content-normalization/index.ts";
export { STORE_DEFECTS_SUITES } from "./defects/index.ts";
export { STORE_EVENTS_SUITES } from "./events/index.ts";
export { STORE_LAYOUT_SUITES } from "./layout/index.ts";
export { STORE_STATE_SUITES } from "./state/index.ts";
export { STORE_RECONSTRUCTION_SUITES } from "./reconstruction/index.ts";

export const STORE_DOMAINS = [
  "capsule",
  "content-normalization",
  "defects",
  "events",
  "layout",
  "state",
  "reconstruction",
] as const;
