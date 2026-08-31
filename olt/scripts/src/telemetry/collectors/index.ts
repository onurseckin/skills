import type { TelemetryCollector } from "../probe-interface.ts";
import type { CollectorEnvironment } from "./common.ts";
import { AntigravityCollector } from "./antigravity.ts";
import { ClaudeCollector } from "./claude.ts";
import { CodexCollector } from "./codex.ts";
import { CursorCollector } from "./cursor.ts";
import { OpenAICollector } from "./openai.ts";

export {
  DefaultCollectorEnvironment,
  MAX_FUTURE_CLOCK_SKEW_MS,
  MAX_STORAGE_CACHE_TTL_MS,
  validateStorageCacheFreshness,
  type CacheFreshnessResult,
  type CollectorEnvironment,
  type ProcessExecResult,
} from "./common.ts";
export {
  CANONICAL_HOSTS,
  canonicalHostToPlatformId,
  detectActiveHost,
  detectHostFromEnvironment,
  detectHostFromExplicit,
  detectHostFromModel,
  detectHostFromProcessTree,
  detectHostFromTerminal,
  isCanonicalHost,
  isPlatformMatchingHost,
  normalizeHostName,
  platformIdToCanonicalHost,
  type CanonicalHost,
  type HostDetectionMechanism,
  type HostDetectionOptions,
  type HostDetectionResult,
  type HostDetectionSignal,
} from "./host-detection.ts";
export { AntigravityCollector } from "./antigravity.ts";
export { ClaudeCollector } from "./claude.ts";
export { CursorCollector } from "./cursor.ts";
export { OpenAICollector } from "./openai.ts";
export { CodexCollector } from "./codex.ts";

export function createDefaultCollectors(env?: CollectorEnvironment): TelemetryCollector[] {
  return [
    new AntigravityCollector(env),
    new ClaudeCollector(env),
    new CursorCollector(env),
    new OpenAICollector(env),
    new CodexCollector(env),
  ];
}
