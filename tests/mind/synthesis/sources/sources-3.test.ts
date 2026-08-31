import { describe, expect, it } from "bun:test";
import {
  deriveWriteScopeForCategory,
  deriveGateForCategory,
  sanitizeSlug,
} from "../../../../olt/scripts/src/mind/tasks/smart/executor/orchestrator.ts";

describe("Mind Synthesis Sources & Categories Suite (Part 1)", () => {
  it("derives write scopes for standard categories", () => {
    const scopeDoc = deriveWriteScopeForCategory("DOCUMENTATION", "doc-item");
    expect(scopeDoc).toContain("docs/");
    
    const scopeAgent = deriveWriteScopeForCategory("AGENT_CONTRACTS", "agent-1");
    expect(scopeAgent).toContain("olt/agents/");
  });

  it("derives gates for various categories", () => {
    const gate = deriveGateForCategory("CLI_TOOLING", ["olt/scripts/src/cli/commands/foo.ts", "tests/cli/foo.test.ts"]);
    expect(gate).toContain("bun test");
  });
});
