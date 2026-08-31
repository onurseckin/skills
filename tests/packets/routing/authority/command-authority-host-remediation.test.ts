import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  assertCognitiveValidatorHardlock,
  assertGrantedCommand as assertRawGrantedCommand,
  assertHierarchicalSpawning,
  resolveCurrentHost,
  validateHierarchicalSpawning,
  type AuthenticatedCaller,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import type { CommandSpec } from "../../../../olt/scripts/src/cli/registry/types.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { emptyGrantRun } from "../../validation/grants/grant-run-fixture.ts";

function spec(invocation: string): CommandSpec {
  const found = findCommand(invocation);
  if (!found) throw new Error(`Registry has no command named ${invocation}`);
  return found;
}

function testCaller(specification: CommandSpec, flags: Flags): AuthenticatedCaller | undefined {
  const callerFlag = ["actor", "validator", "critic", "agent"].find((name) => {
    if (
      (specification.name === "agent:register" ||
        specification.name === "agent:report" ||
        specification.name === "agent:release") &&
      name === "agent"
    ) {
      return false;
    }
    return typeof flags[name] === "string" && flags[name].trim() !== "";
  });
  if (callerFlag === undefined) return undefined;
  return { actor: flags[callerFlag] as string, role: "test", verified: true };
}

function assertGrantedCommand(
  specification: CommandSpec,
  flags: Flags,
  caller?: AuthenticatedCaller,
  hostEnv?: Record<string, string | undefined>,
) {
  const detectedHost = hostEnv !== undefined ? resolveCurrentHost(hostEnv) : undefined;
  return assertRawGrantedCommand(
    specification,
    flags,
    caller ?? testCaller(specification, flags),
    detectedHost,
  );
}

describe("host detection and remediation resolution", () => {
  test("resolveCurrentHost detects active host or returns unknown safely", () => {
    expect(resolveCurrentHost({ ANTIGRAVITY_APP_DIR: "/app" })).toBe("antigravity");
    expect(resolveCurrentHost({ GEMINI_CLI_HOME: "/gemini" })).toBe("antigravity");
    expect(resolveCurrentHost({ CLAUDE_PROJECT_DIR: "/project" })).toBe("claude_code");
    expect(resolveCurrentHost({ CLAUDE_CODE_ENTRY: "1" })).toBe("claude_code");
    expect(resolveCurrentHost({ CODEX_RUNTIME: "codex-1" })).toBe("codex");
    expect(resolveCurrentHost({ CODEX_THREAD_ID: "th-1" })).toBe("codex");
    expect(resolveCurrentHost({ CURSOR_PROJECT_DIR: "/cursor" })).toBe("cursor");
    expect(resolveCurrentHost({})).toBe("unknown");
  });
});

describe("assertCognitiveValidatorHardlock host remediation", () => {
  test("provides Antigravity invoke_subagent remediation guidance", () => {
    let thrown: unknown;
    try {
      assertCognitiveValidatorHardlock("validator", "run:exec", "val-1", "antigravity");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const message = (thrown as HarnessError).message;
    expect(message).toContain("invoke_subagent");
    expect(message).toContain("Antigravity");
    expect(message).toContain("mechanic-validator");
    expect(message).toContain("view_file");
  });

  test("provides Claude Code Agent/Task tools remediation guidance", () => {
    let thrown: unknown;
    try {
      assertCognitiveValidatorHardlock("validator", "run:exec", "val-1", "claude_code");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const message = (thrown as HarnessError).message;
    expect(message).toContain("Claude Code");
    expect(message).toContain("Agent/Task tools");
  });

  test("provides Codex spawn_agent remediation guidance", () => {
    let thrown: unknown;
    try {
      assertCognitiveValidatorHardlock("validator", "run:exec", "val-1", "codex");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const message = (thrown as HarnessError).message;
    expect(message).toContain("Codex");
    expect(message).toContain("spawn_agent");
  });
});

describe("hierarchical spawning host remediation", () => {
  test("provides host-aware guidance for Tier 0 Mind spawning boundary violations", () => {
    const agResult = validateHierarchicalSpawning("mind", "implementer", "antigravity");
    expect(agResult.valid).toBe(false);
    expect(agResult.remediation).toContain("Antigravity");
    expect(agResult.remediation).toContain("invoke_subagent");

    const ccResult = validateHierarchicalSpawning("mind", "implementer", "claude_code");
    expect(ccResult.valid).toBe(false);
    expect(ccResult.remediation).toContain("Claude Code");
    expect(ccResult.remediation).toContain("Agent / Task tools");

    const codexResult = validateHierarchicalSpawning("mind", "implementer", "codex");
    expect(codexResult.valid).toBe(false);
    expect(codexResult.remediation).toContain("Codex");
    expect(codexResult.remediation).toContain("spawn_agent");
  });

  test("provides host-aware guidance for Tier 1 Orchestrator spawning boundary violations", () => {
    const agResult = validateHierarchicalSpawning("orchestrator", "implementer", "antigravity");
    expect(agResult.valid).toBe(false);
    expect(agResult.remediation).toContain("Antigravity");
    expect(agResult.remediation).toContain(
      "Tier 1 Orchestrator must dispatch a Tier 2 Coordinator",
    );
    expect(agResult.remediation).toContain("invoke_subagent");
  });

  test("provides host-aware guidance for Tier 2 Coordinator spawning boundary violations", () => {
    const agResult = validateHierarchicalSpawning("coordinator", "orchestrator", "antigravity");
    expect(agResult.valid).toBe(false);
    expect(agResult.remediation).toContain("Antigravity");
    expect(agResult.remediation).toContain("Tier 2 Coordinator must dispatch Tier 3 workers");
    expect(agResult.remediation).toContain("invoke_subagent");
  });

  test("provides host-aware guidance for Tier 3 Worker spawning boundary violations", () => {
    const agResult = validateHierarchicalSpawning("implementer", "validator", "antigravity");
    expect(agResult.valid).toBe(false);
    expect(agResult.remediation).toContain("Antigravity");
    expect(agResult.remediation).toContain("Tier 3 execution workers are leaf nodes");
  });

  test("assertHierarchicalSpawning embeds remediation in HarnessError", () => {
    let thrown: unknown;
    try {
      assertHierarchicalSpawning("mind", "implementer", "mind-1", "impl-1", "antigravity");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const message = (thrown as HarnessError).message;
    expect(message).toContain("invoke_subagent");
    expect(message).toContain("Antigravity");
  });
});

describe("assertGrantedCommand host-aware remediation", () => {
  test("includes host remediation when cognitive validator executes banned tools", async () => {
    const { run } = await emptyGrantRun("command-authority-host-tool-ban-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "val-1",
          role: "validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, validator: "val-1", tool: "bash" };
    let thrown: unknown;
    try {
      assertGrantedCommand(spec("task:probe"), flags, undefined, { ANTIGRAVITY_APP_DIR: "/app" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const message = (thrown as HarnessError).message;
    expect(message).toContain("may not invoke execution tool");
    expect(message).toContain("invoke_subagent");
    expect(message).toContain("Antigravity");
  });

  test("includes host remediation on unparented Tier 2+ registration", async () => {
    const { run } = await emptyGrantRun("command-authority-host-unparented-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "orch-1",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, actor: "orch-1", role: "implementer", agent: "impl-1" };
    let thrown: unknown;
    try {
      assertGrantedCommand(spec("agent:register"), flags, undefined, {
        ANTIGRAVITY_APP_DIR: "/app",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const message = (thrown as HarnessError).message;
    expect(message).toContain("cannot be dispatched without a supervising parent agent");
    expect(message).toContain("invoke_subagent");
    expect(message).toContain("Antigravity");
  });
});

describe("structural invariants and cleanliness", () => {
  test("all module files are <= 300 lines and contain zero code comments", () => {
    const files = [
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority-remediation.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority-predicates.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority-hierarchy.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority-state.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority-invocation.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority-grants.ts",
      "/Users/onurseckinsenoglu/repos/skills/tests/packets/routing/authority/command-authority-host-remediation.test.ts",
    ];

    const commentPattern = new RegExp("\\/\\/|\\/\\*|\\*\\/");
    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    for (const file of files) {
      expect(existsSync(file)).toBe(true);
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (
          line.includes("commentPattern") ||
          line.includes("anyPattern") ||
          line.includes("suppressionPattern")
        ) {
          continue;
        }
        expect(commentPattern.test(line)).toBe(false);
        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
