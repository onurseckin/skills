import { HarnessError } from "../errors/harness-error.ts";
import { AntigravityHostAdapter } from "./antigravity.ts";
import { ChatGptHostAdapter } from "./chatgpt.ts";
import { ClaudeCodeHostAdapter } from "./claude-code.ts";
import { CodexHostAdapter } from "./codex.ts";
import { CursorHostAdapter } from "./cursor.ts";
import {
  dispatchSubagent,
  getHostAdapter,
  listHostCapabilities,
  listSupportedHostProviders,
  resolveHostProvider,
} from "./host-adapter-registry.ts";
import {
  HOST_PROVIDERS,
  isHostProvider,
  type CognitiveFallbackPromptResult,
  type DispatchResult,
  type HostAdapter,
  type HostCapabilities,
  type HostProvider,
  type MandatoryCliActionSequence,
  type MechanicalDispatchResult,
  type SubagentDispatchPacket,
  type WorkspaceIsolationMode,
} from "./types.ts";

export {
  AntigravityHostAdapter,
  ChatGptHostAdapter,
  ClaudeCodeHostAdapter,
  CodexHostAdapter,
  CursorHostAdapter,
  HOST_PROVIDERS,
  dispatchSubagent,
  getHostAdapter,
  isHostProvider,
  listHostCapabilities,
  listSupportedHostProviders,
  resolveHostProvider,
};

export type {
  CognitiveFallbackPromptResult,
  DispatchResult,
  HostAdapter,
  HostCapabilities,
  HostProvider,
  MandatoryCliActionSequence,
  MechanicalDispatchResult,
  SubagentDispatchPacket,
  WorkspaceIsolationMode,
};

export interface DispatchOptions {
  readonly forceCognitiveFallback?: boolean | undefined;
  readonly onFallbackTriggered?: ((reason: string) => void) | undefined;
}

export function validateDispatchPacket(packet: SubagentDispatchPacket): void {
  if (!packet.agentId || typeof packet.agentId !== "string" || packet.agentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Dispatch packet requires a non-empty agentId");
  }
  if (!packet.role || typeof packet.role !== "string" || packet.role.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Dispatch packet requires a non-empty role");
  }
  if (!packet.runRoot || typeof packet.runRoot !== "string" || packet.runRoot.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Dispatch packet requires a non-empty runRoot");
  }
  if (!packet.taskDescription || typeof packet.taskDescription !== "string" || packet.taskDescription.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Dispatch packet requires a non-empty taskDescription");
  }
  if (!Array.isArray(packet.writeScope)) {
    throw new HarnessError("INVALID_ARGUMENT", "Dispatch packet writeScope must be an array");
  }
}

export class MechanicalFirstDispatcher {
  public static dispatch(
    provider: HostProvider,
    packet: SubagentDispatchPacket,
    options: DispatchOptions = {},
  ): DispatchResult {
    validateDispatchPacket(packet);
    const adapter = getHostAdapter(provider);

    if (options.forceCognitiveFallback) {
      if (options.onFallbackTriggered) {
        options.onFallbackTriggered("forceCognitiveFallback option requested");
      }
      return adapter.generateCognitiveFallbackPrompt(packet);
    }

    if (!adapter.capabilities.supportsMechanicalDispatch) {
      if (options.onFallbackTriggered) {
        options.onFallbackTriggered(
          `Host provider '${provider}' does not support mechanical dispatch; falling back to cognitive prompt`,
        );
      }
      return adapter.generateCognitiveFallbackPrompt(packet);
    }

    try {
      return adapter.dispatchMechanical(packet);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (options.onFallbackTriggered) {
        options.onFallbackTriggered(`Mechanical dispatch failed: ${message}; falling back to cognitive prompt`);
      }
      return adapter.generateCognitiveFallbackPrompt(packet);
    }
  }

  public static buildMandatoryCliSequence(
    provider: HostProvider,
    runRoot: string,
    agentId: string,
    role: import("../contracts/packets.ts").AgentRole,
    taskId: string,
  ): MandatoryCliActionSequence {
    const adapter = getHostAdapter(provider);
    return adapter.buildMandatoryCliSequence(runRoot, agentId, role, taskId);
  }
}

export function dispatchWithFallback(
  provider: HostProvider,
  packet: SubagentDispatchPacket,
  options?: DispatchOptions | undefined,
): DispatchResult {
  return MechanicalFirstDispatcher.dispatch(provider, packet, options ?? {});
}
