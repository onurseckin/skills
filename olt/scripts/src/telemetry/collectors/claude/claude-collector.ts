import { join } from "node:path";
import { BaseTieredCollector, type TierResult } from "../../base-collector.ts";
import { DefaultCollectorEnvironment, type CollectorEnvironment } from "../common.ts";
import {
  parseClaudeCliUsageOutput,
  parseClaudeCliVersionOutput,
  parseClaudeRuntimeEnv,
  parseClaudeStoragePayload,
  parseClaudeUsagePayload,
} from "./stream-parser.ts";

export class ClaudeCollector extends BaseTieredCollector {
  public readonly platformId = "claude";
  private readonly env: DefaultCollectorEnvironment;

  constructor(env: CollectorEnvironment = {}) {
    super();
    this.env = new DefaultCollectorEnvironment(env);
  }

  protected async probeTier1Cli(): Promise<TierResult | null> {
    const statusPayload = await this.env.fetchClaudeUsage();
    if (statusPayload) {
      const parsed = parseClaudeUsagePayload(statusPayload, "tier1_cli_command", "verified_exact");
      if (parsed) {
        return parsed;
      }
    }

    const usageResult = await this.env.exec("claude", ["/usage", "--json"]);
    if (usageResult && usageResult.stdout.trim()) {
      return parseClaudeCliUsageOutput(usageResult.stdout);
    }

    const verResult = await this.env.exec("claude", ["--version"]);
    if (verResult && verResult.stdout.trim()) {
      return parseClaudeCliVersionOutput(verResult.stdout);
    }

    return null;
  }

  protected async probeTier2Storage(): Promise<TierResult | null> {
    const home = this.env.homedir;
    const candidates = [
      join(home, ".claude.json"),
      join(home, ".claude", "stats.json"),
      join(home, ".claude", "config.json"),
      join(home, ".config", "claude", "session.json"),
    ];

    const isExternalCache = !this.env.isHostActive("claude");
    for (const filePath of candidates) {
      const content = await this.env.readFile(filePath);
      if (content) {
        const parsed = parseClaudeStoragePayload(content, filePath, { isExternalCache });
        if (parsed) {
          return parsed;
        }
      }
    }
    return null;
  }

  protected async probeTier3Runtime(): Promise<TierResult | null> {
    return parseClaudeRuntimeEnv(this.env.env);
  }

  protected override getTerminalReason(): string {
    return "No Claude Session · No API Key";
  }
}
