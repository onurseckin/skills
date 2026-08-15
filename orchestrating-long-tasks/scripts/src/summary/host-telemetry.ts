import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostAgentMetadata, ModelTier, TokenUsageDetail } from "./types.ts";

export interface HostModelDetectionResult {
  model?: string;
  tier?: ModelTier;
  hostAgent?: HostAgentMetadata;
}

export function resolveModelTier(modelName: string): ModelTier {
  const lower = modelName.toLowerCase();
  if (
    lower.includes("pro") ||
    lower.includes("opus") ||
    lower.includes("large") ||
    lower.includes("high") ||
    lower.includes("o1") ||
    lower.includes("o3")
  ) {
    return "l";
  }
  if (
    lower.includes("flash") ||
    lower.includes("haiku") ||
    lower.includes("small") ||
    lower.includes("lite") ||
    lower.includes("mini")
  ) {
    return "s";
  }
  return "m";
}

export function detectHostTelemetry(agentId?: string): HostModelDetectionResult {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();

  // 1. Antigravity CLI Adapter
  try {
    const agSettingsPath = join(homeDir, ".gemini", "antigravity-cli", "settings.json");
    if (existsSync(agSettingsPath)) {
      const raw = readFileSync(agSettingsPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        model?: string;
        thinkingLevel?: string;
        reasoningEffort?: string;
      };
      if (typeof parsed.model === "string" && parsed.model.trim().length > 0) {
        let modelStr = parsed.model.trim();
        const thinking = parsed.thinkingLevel || parsed.reasoningEffort;
        let thinkingLevel: string | undefined = undefined;
        if (thinking && !modelStr.toLowerCase().includes(thinking.toLowerCase())) {
          const capitalizedThinking = thinking.charAt(0).toUpperCase() + thinking.slice(1);
          modelStr = `${modelStr} (${capitalizedThinking})`;
          thinkingLevel = thinking.toLowerCase();
        } else if (modelStr.includes("(") && modelStr.includes(")")) {
          const match = modelStr.match(/\(([^)]+)\)/);
          if (match) thinkingLevel = match[1]!.toLowerCase();
        }
        const tier = resolveModelTier(modelStr);
        const hostAgent: HostAgentMetadata = {
          hostTool: "antigravity",
          modelName: modelStr,
          ...(thinkingLevel ? { thinkingLevel } : {}),
          modelTier: tier,
        };
        return { model: modelStr, tier, hostAgent };
      }
    }
  } catch {}

  // 2. Claude Code Adapter
  try {
    const claudeEnvModel = process.env.CLAUDE_CODE_MODEL || process.env.ANTHROPIC_MODEL;
    const claudeConfigPath = join(homeDir, ".claude.json");
    let claudeModel: string | undefined = claudeEnvModel;
    if (!claudeModel && existsSync(claudeConfigPath)) {
      const raw = readFileSync(claudeConfigPath, "utf-8");
      const parsed = JSON.parse(raw) as { model?: string; currentModel?: string };
      claudeModel = parsed.model || parsed.currentModel;
    }
    if (claudeModel && claudeModel.trim().length > 0) {
      const modelStr = claudeModel.trim();
      const tier = resolveModelTier(modelStr);
      const hostAgent: HostAgentMetadata = {
        hostTool: "claude-code",
        modelName: modelStr,
        modelTier: tier,
      };
      return { model: modelStr, tier, hostAgent };
    }
  } catch {}

  // 3. Cursor / Codex Adapter
  try {
    const cursorEnvModel = process.env.CURSOR_MODEL;
    if (cursorEnvModel && cursorEnvModel.trim().length > 0) {
      const modelStr = cursorEnvModel.trim();
      const tier = resolveModelTier(modelStr);
      const hostAgent: HostAgentMetadata = {
        hostTool: "cursor",
        modelName: modelStr,
        modelTier: tier,
      };
      return { model: modelStr, tier, hostAgent };
    }
  } catch {}

  // 4. Environment Variables fallback check (Explicit only, no fabrication)
  const envModel =
    process.env.MODEL ??
    process.env.AI_MODEL ??
    process.env.GEMINI_MODEL ??
    process.env.ANTIGRAVITY_MODEL;
  if (envModel && envModel.trim().length > 0) {
    const modelStr = envModel.trim();
    const tier = resolveModelTier(modelStr);
    const hostAgent: HostAgentMetadata = {
      hostTool: "custom",
      modelName: modelStr,
      modelTier: tier,
    };
    return { model: modelStr, tier, hostAgent };
  }

  // 5. Undetected: Return undefined (Rule 1 & Rule 2: Zero Fallback Fabrication)
  return { model: undefined, tier: undefined, hostAgent: undefined };
}

export function detectHostModel(agentId?: string): {
  model?: string;
  tier?: ModelTier;
} {
  const result = detectHostTelemetry(agentId);
  return { model: result.model, tier: result.tier };
}
