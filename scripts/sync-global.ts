/**
 * Backward-compatibility proxy for scripts/sync/index.ts
 */
export * from "./sync/index";
import { runSync } from "./sync/index";

runSync();
