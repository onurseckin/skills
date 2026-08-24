import type { TelemetryCollector } from "../probe-interface.ts";
import type { CollectorEnvironment } from "./common.ts";
import { AntigravityCollector } from "./antigravity.ts";
import { ClaudeCollector } from "./claude.ts";
import { CursorCollector } from "./cursor.ts";
import { OpenAICollector } from "./openai.ts";
import { CodexCollector } from "./codex.ts";

export * from "./common.ts";
export * from "./antigravity.ts";
export * from "./claude.ts";
export * from "./cursor.ts";
export * from "./openai.ts";
export * from "./codex.ts";

export function createDefaultCollectors(env?: CollectorEnvironment): TelemetryCollector[] {
  return [
    new AntigravityCollector(env),
    new ClaudeCollector(env),
    new CursorCollector(env),
    new OpenAICollector(env),
    new CodexCollector(env),
  ];
}
