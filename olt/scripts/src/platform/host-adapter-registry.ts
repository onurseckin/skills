import { HarnessError } from "../errors/harness-error.ts";
import { AntigravityHostAdapter } from "./antigravity.ts";
import { ClaudeCodeHostAdapter } from "./claude-code.ts";
import { CursorHostAdapter } from "./cursor.ts";
import { CodexHostAdapter } from "./codex.ts";
import { ChatGptHostAdapter } from "./chatgpt.ts";
import {
  HOST_PROVIDERS,
  isHostProvider,
  type DispatchResult,
  type HostAdapter,
  type HostCapabilities,
  type HostProvider,
  type SubagentDispatchPacket,
} from "./types.ts";

const ADAPTER_MAP: Readonly<Record<HostProvider, () => HostAdapter>> = {
  antigravity: () => new AntigravityHostAdapter(),
  "claude-code": () => new ClaudeCodeHostAdapter(),
  cursor: () => new CursorHostAdapter(),
  codex: () => new CodexHostAdapter(),
  chatgpt: () => new ChatGptHostAdapter(),
};

export function getHostAdapter(provider: HostProvider): HostAdapter {
  const factory = ADAPTER_MAP[provider];
  if (!factory) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Unsupported host provider '${provider}'. Supported host providers: ${HOST_PROVIDERS.join(", ")}`,
    );
  }
  return factory();
}

export function listSupportedHostProviders(): readonly HostProvider[] {
  return [...HOST_PROVIDERS];
}

export function listHostCapabilities(): readonly HostCapabilities[] {
  return HOST_PROVIDERS.map((provider) => getHostAdapter(provider).capabilities);
}

export function resolveHostProvider(rawHost?: string | null): HostProvider {
  if (!rawHost || typeof rawHost !== "string" || !rawHost.trim()) {
    return "antigravity";
  }

  const normalized = rawHost.trim().toLowerCase();
  if (isHostProvider(normalized)) {
    return normalized;
  }

  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return "claude-code";
  }
  if (normalized.includes("cursor")) {
    return "cursor";
  }
  if (normalized.includes("codex") || normalized.includes("openai-codex")) {
    return "codex";
  }
  if (
    normalized.includes("chatgpt") ||
    normalized.includes("gpt") ||
    normalized.includes("openai")
  ) {
    return "chatgpt";
  }
  if (normalized.includes("antigravity") || normalized.includes("gemini")) {
    return "antigravity";
  }

  return "antigravity";
}

export function dispatchSubagent(
  provider: HostProvider,
  packet: SubagentDispatchPacket,
  options?: { forceCognitiveFallback?: boolean },
): DispatchResult {
  const adapter = getHostAdapter(provider);
  return adapter.dispatch(packet, options);
}
