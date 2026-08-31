/**
 * @file index.ts
 * Root Facade for Server test suites.
 */

export { serverDockerSuite } from "./docker/index.ts";
export { serverLifecycleSuite } from "./lifecycle/index.ts";
export { serverProbeSuite } from "./probe/index.ts";
export { serverProcessSuite } from "./process/index.ts";
