import type { TelemetryCollector } from "../probe-interface.ts";
import type { CollectorEnvironment } from "./common.ts";
import { AntigravityCollector } from "./antigravity.ts";
import { ClaudeCollector } from "./claude.ts";
import { CodexCollector } from "./codex.ts";
import { CursorCollector } from "./cursor.ts";
import { OpenAICollector } from "./openai.ts";

export {
  DefaultCollectorEnvironment,
  type CollectorEnvironment,
  type ProcessExecResult,
} from "./common.ts";
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
