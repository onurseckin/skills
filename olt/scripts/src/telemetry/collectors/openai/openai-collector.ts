import { BaseTieredCollector, type TierResult } from "../../base-collector.ts";
import { DefaultCollectorEnvironment, type CollectorEnvironment } from "../common.ts";
import { parseCodexRolloutUsage } from "./rollout-parser.ts";
import {
  parseCliFallback,
  parseOpenAIStorage,
  parseCodexStorage,
  parseRuntimeEnv,
} from "./fallback-parser.ts";

export class OpenAICollector extends BaseTieredCollector {
  public override readonly platformId: string = "openai";
  protected readonly env: DefaultCollectorEnvironment;

  constructor(env: CollectorEnvironment = {}) {
    super();
    this.env = new DefaultCollectorEnvironment(env);
  }

  protected async probeTier1Cli(): Promise<TierResult | null> {
    return parseCliFallback(this.env, "openai", "openai_tokens_remaining");
  }

  protected async probeTier2Storage(): Promise<TierResult | null> {
    return parseOpenAIStorage(this.env);
  }

  protected async probeTier3Runtime(): Promise<TierResult | null> {
    return parseRuntimeEnv(this.env.env, [
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "OPENAI_ORG_ID",
      "OPENAI_PROJECT_ID",
    ]);
  }

  protected override getTerminalReason(): string {
    return "No Codex Sessions · No API Key";
  }
}

export class CodexCollector extends BaseTieredCollector {
  public override readonly platformId: string = "codex";
  private readonly env: DefaultCollectorEnvironment;

  constructor(env: CollectorEnvironment = {}) {
    super();
    this.env = new DefaultCollectorEnvironment(env);
  }

  protected async probeTier1Cli(): Promise<TierResult | null> {
    const codexUsage = await this.env.fetchCodexUsage();
    if (codexUsage) {
      const rolloutResult = parseCodexRolloutUsage(codexUsage);
      if (rolloutResult) {
        return rolloutResult;
      }
    }

    return parseCliFallback(this.env, "codex", "codex_tokens_remaining");
  }

  protected async probeTier2Storage(): Promise<TierResult | null> {
    return parseCodexStorage(this.env);
  }

  protected async probeTier3Runtime(): Promise<TierResult | null> {
    return parseRuntimeEnv(this.env.env, ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_SESSION_ID"]);
  }

  protected override getTerminalReason(): string {
    return "No Codex Sessions · No API Key";
  }
}
