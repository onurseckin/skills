export { BUN_COMPATIBILITY, compatibleBunVersion } from "./bun-compatibility.ts";

export {
  appendCapsuleDefect,
  compactCapsuleDefects,
  loadCapsuleDefects,
  resolveCapsuleDefect,
} from "./defect-store.ts";

export { quarantineAndTruncateTail } from "./forensic-tail.ts";

export { recoverProjection, recoverProjectionLocked } from "./recovery.ts";

export { appendTraceStep, writeTrace } from "./trace.ts";
