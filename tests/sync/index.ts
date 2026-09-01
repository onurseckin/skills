/**
 * @file index.ts
 * Root Facade for Sync domain
 */

export { SYNC_DEPLOYER_SUITES } from "./deployer/index.ts";
export { SYNC_GIT_SUITES } from "./git/index.ts";
export { SYNC_SHELL_SUITES } from "./shell/index.ts";
export { SYNC_FS_SUITES } from "./fs/index.ts";
export { SYNC_PIPELINE_SUITES } from "./pipeline/index.ts";

export const SYNC_DOMAINS = ["deployer", "git", "shell", "fs", "pipeline"] as const;
