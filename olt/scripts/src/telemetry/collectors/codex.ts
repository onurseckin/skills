import { OpenAICollector } from "./openai.ts";
import type { CollectorEnvironment } from "./common.ts";

export class CodexCollector extends OpenAICollector {
  public override readonly platformId: string = "codex";

  constructor(env: CollectorEnvironment = {}) {
    super(env);
  }
}
