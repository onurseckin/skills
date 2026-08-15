import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostAgentMetadata, ModelTier } from "./types.ts";

export interface HostModelDetectionResult {
  model?: string;
  tier?: ModelTier;
  hostAgent?: HostAgentMetadata;
}

export interface DetectHostTelemetryOptions {
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

export function resolveModelTier(modelName: string): ModelTier {
  const lower = modelName.toLowerCase();
  if (lower.includes("nano") || lower.includes("micro") || lower.includes("xs")) {
    return "xs";
  }
  if (
    lower.includes("pro") ||
    lower.includes("opus") ||
    lower.includes("large") ||
    lower.includes("high") ||
    lower.includes("ultra") ||
    lower.includes("max") ||
    lower.includes("o1") ||
    lower.includes("o3") ||
    lower.includes("r1")
  ) {
    return "l";
  }
  if (
    lower.includes("flash") ||
    lower.includes("haiku") ||
    lower.includes("small") ||
    lower.includes("lite") ||
    lower.includes("mini") ||
    lower.includes("instant")
  ) {
    return "s";
  }
  return "m";
}

function parseJsonSafe(raw: string): Record<string, unknown> | null {
  try {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // JSON parsing error ignored safely
  }
  return null;
}

export function detectHostTelemetry(
  agentId?: string,
  options?: DetectHostTelemetryOptions,
): HostModelDetectionResult {
  const env = options?.env ?? process.env;
  const homeDir =
    options?.homeDir ??
    (env.HOME && env.HOME.trim().length > 0 ? env.HOME.trim() : undefined) ??
    (env.USERPROFILE && env.USERPROFILE.trim().length > 0 ? env.USERPROFILE.trim() : undefined) ??
    (() => {
      try {
        const h = homedir();
        return h && h.trim().length > 0 ? h.trim() : undefined;
      } catch {
        return undefined;
      }
    })();

  // 1. Antigravity CLI Adapter
  if (homeDir) {
    try {
      const agSettingsPath = join(homeDir, ".gemini", "antigravity-cli", "settings.json");
      if (existsSync(agSettingsPath)) {
        const raw = readFileSync(agSettingsPath, "utf-8");
        const parsed = parseJsonSafe(raw);
        if (parsed && typeof parsed.model === "string" && parsed.model.trim().length > 0) {
          let modelStr = parsed.model.trim();
          const thinking =
            (typeof parsed.thinkingLevel === "string" && parsed.thinkingLevel.trim().length > 0
              ? parsed.thinkingLevel.trim()
              : undefined) ||
            (typeof parsed.reasoningEffort === "string" && parsed.reasoningEffort.trim().length > 0
              ? parsed.reasoningEffort.trim()
              : undefined);
          let thinkingLevel: string | undefined = undefined;

          if (thinking) {
            // Strip any existing parenthesized suffix to avoid double format like (High) (Medium)
            const baseModel = modelStr.replace(/\s*\([^)]+\)$/, "").trim();
            const capitalizedThinking =
              thinking.charAt(0).toUpperCase() + thinking.slice(1).toLowerCase();
            modelStr = `${baseModel} (${capitalizedThinking})`;
            thinkingLevel = thinking.toLowerCase();
          } else if (modelStr.includes("(") && modelStr.includes(")")) {
            const match = modelStr.match(/\(([^)]+)\)/);
            if (match && match[1]) {
              thinkingLevel = match[1].trim().toLowerCase();
            }
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
    } catch {
      // Adapter failures ignored safely
    }
  }

  // 2. Claude Code Adapter
  try {
    const claudeEnvModel =
      (env.CLAUDE_CODE_MODEL && env.CLAUDE_CODE_MODEL.trim().length > 0
        ? env.CLAUDE_CODE_MODEL.trim()
        : undefined) ||
      (env.ANTHROPIC_MODEL && env.ANTHROPIC_MODEL.trim().length > 0
        ? env.ANTHROPIC_MODEL.trim()
        : undefined);
    let claudeModel: string | undefined = claudeEnvModel;
    if (!claudeModel && homeDir) {
      const claudeConfigPath = join(homeDir, ".claude.json");
      if (existsSync(claudeConfigPath)) {
        const raw = readFileSync(claudeConfigPath, "utf-8");
        const parsed = parseJsonSafe(raw);
        if (parsed) {
          if (typeof parsed.model === "string" && parsed.model.trim().length > 0) {
            claudeModel = parsed.model.trim();
          } else if (
            typeof parsed.currentModel === "string" &&
            parsed.currentModel.trim().length > 0
          ) {
            claudeModel = parsed.currentModel.trim();
          }
        }
      }
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
  } catch {
    // Adapter failures ignored safely
  }

  // 3. Cursor / Codex Adapter
  try {
    const cursorEnvModel = env.CURSOR_MODEL;
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
  } catch {
    // Adapter failures ignored safely
  }

  // 4. Explicit Environment Variables fallback check (No fabrication)
  const envModel = [env.MODEL, env.AI_MODEL, env.GEMINI_MODEL, env.ANTIGRAVITY_MODEL].find(
    (v) => typeof v === "string" && v.trim().length > 0,
  );

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

  // 5. Undetected: Return empty object (Zero Fallback Fabrication)
  return {};
}

export function detectHostModel(
  agentId?: string,
  options?: DetectHostTelemetryOptions,
): {
  model?: string;
  tier?: ModelTier;
} {
  const result = detectHostTelemetry(agentId, options);
  return {
    ...(result.model !== undefined ? { model: result.model } : {}),
    ...(result.tier !== undefined ? { tier: result.tier } : {}),
  };
}
