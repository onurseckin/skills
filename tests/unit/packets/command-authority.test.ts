import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import {
  assertGrantedCommand,
  isExecutionCommand,
  isExecutionToolCategory,
  isProhibitedCognitiveTool,
  roleToTier,
  validateHierarchicalSpawning,
  assertHierarchicalSpawning,
  assertCognitiveValidatorHardlock,
  assertRoleMayInvoke,
} from "../../../olt/scripts/src/packets/command-authority.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { emptyGrantRun } from "./grant-run-fixture.ts";

function spec(invocation: string) {
  const found = findCommand(invocation);
  if (!found) throw new Error(`the registry has no command named ${invocation}`);
  return found;
}

describe("command predicates and classification", () => {
  test("isExecutionCommand identifies execution commands and aliases", () => {
    expect(isExecutionCommand(spec("run:exec"))).toBe(true);
    expect(isExecutionCommand(spec("task:submit"))).toBe(false);
  });

  test("isExecutionToolCategory identifies execution tool categories", () => {
    expect(isExecutionToolCategory("shell")).toBe(true);
    expect(isExecutionToolCategory("terminal")).toBe(true);
    expect(isExecutionToolCategory("exec")).toBe(true);
    expect(isExecutionToolCategory("test-runner")).toBe(true);
    expect(isExecutionToolCategory("package-manager")).toBe(true);
    expect(isExecutionToolCategory("code_editor")).toBe(false);
  });

  test("isProhibitedCognitiveTool identifies banned cognitive tools", () => {
    expect(isProhibitedCognitiveTool("bash")).toBe(true);
    expect(isProhibitedCognitiveTool("run_command")).toBe(true);
    expect(isProhibitedCognitiveTool("bun_test")).toBe(true);
    expect(isProhibitedCognitiveTool("terminal")).toBe(true);
    expect(isProhibitedCognitiveTool("view_file")).toBe(false);
  });

  test("roleToTier maps roles to their numerical hierarchy tiers", () => {
    expect(roleToTier("mind")).toBe(0);
    expect(roleToTier("mind-lead")).toBe(0);
    expect(roleToTier("orchestrator")).toBe(1);
    expect(roleToTier("orch-main")).toBe(1);
    expect(roleToTier("coordinator")).toBe(2);
    expect(roleToTier("coord-1")).toBe(2);
    expect(roleToTier("implementer")).toBe(3);
    expect(roleToTier("validator")).toBe(3);
    expect(roleToTier("repairer")).toBe(3);
    expect(roleToTier("custom-role")).toBe(3);
  });
});

describe("validateHierarchicalSpawning & assertHierarchicalSpawning", () => {
  test("allows Tier 0 Mind to spawn Tier 1 Orchestrator only", () => {
    expect(validateHierarchicalSpawning("mind", "orchestrator").valid).toBe(true);
    expect(validateHierarchicalSpawning("mind", "coordinator").valid).toBe(false);
    expect(validateHierarchicalSpawning("mind", "implementer").valid).toBe(false);
  });

  test("allows Tier 1 Orchestrator to spawn Tier 2 Coordinator only", () => {
    expect(validateHierarchicalSpawning("orchestrator", "coordinator").valid).toBe(true);
    expect(validateHierarchicalSpawning("orchestrator", "implementer").valid).toBe(false);
    expect(validateHierarchicalSpawning("orchestrator", "orchestrator").valid).toBe(false);
  });

  test("allows Tier 2 Coordinator to spawn Tier 3 workers only", () => {
    expect(validateHierarchicalSpawning("coordinator", "implementer").valid).toBe(true);
    expect(validateHierarchicalSpawning("coordinator", "validator").valid).toBe(true);
    expect(validateHierarchicalSpawning("coordinator", "repairer").valid).toBe(true);
    expect(validateHierarchicalSpawning("coordinator", "orchestrator").valid).toBe(false);
  });

  test("disallows Tier 3 workers from spawning subagents", () => {
    expect(validateHierarchicalSpawning("implementer", "validator").valid).toBe(false);
    expect(validateHierarchicalSpawning("validator", "repairer").valid).toBe(false);
  });

  test("assertHierarchicalSpawning throws HarnessError when invalid", () => {
    expect(() => assertHierarchicalSpawning("mind", "implementer", "mind-1", "impl-1")).toThrow(
      HarnessError,
    );
    expect(() => assertHierarchicalSpawning("orchestrator", "coordinator")).not.toThrow();
  });
});

describe("assertCognitiveValidatorHardlock", () => {
  test("throws HarnessError on cognitive validator executing run:exec or shell tool", () => {
    expect(() => assertCognitiveValidatorHardlock("validator", "run:exec", "val-1")).toThrow(
      HarnessError,
    );
    expect(() => assertCognitiveValidatorHardlock("validator", "bash", "val-1")).toThrow(
      HarnessError,
    );
    expect(() => assertCognitiveValidatorHardlock("validator", "terminal")).toThrow(HarnessError);
  });

  test("allows mechanic validator or other roles without throwing", () => {
    expect(() =>
      assertCognitiveValidatorHardlock("mechanic-validator", "run:exec", "mech-1"),
    ).not.toThrow();
    expect(() =>
      assertCognitiveValidatorHardlock("implementer", "run:exec", "impl-1"),
    ).not.toThrow();
    expect(() => assertCognitiveValidatorHardlock("validator", "view_file", "val-1")).not.toThrow();
  });
});

describe("assertRoleMayInvoke", () => {
  test("allows granted commands in contract", () => {
    expect(() => assertRoleMayInvoke("implementer", spec("task:submit"), "impl-1")).not.toThrow();
  });

  test("throws when role contract does not permit command", () => {
    expect(() => assertRoleMayInvoke("validator", spec("task:submit"), "val-1")).toThrow(
      HarnessError,
    );
  });
});

describe("assertGrantedCommand", () => {
  test("returns early when run flag is absent or no acting agent is provided", () => {
    expect(() => assertGrantedCommand(spec("task:submit"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("task:submit"), { run: "/some/path" })).not.toThrow();
  });

  test("returns early when run state has no matching agent grant", async () => {
    const { run } = await emptyGrantRun("command-authority-no-grant-");
    expect(() =>
      assertGrantedCommand(spec("task:submit"), { run, agent: "unregistered-agent" }),
    ).not.toThrow();
  });

  test("swallows a state.json that exists but does not belong to a real capsule", async () => {
    const { repo } = await emptyGrantRun("command-authority-broken-capsule-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    await writeFile(join(brokenRoot, "state.json"), "{}");
    const flags: Flags = { run: brokenRoot, agent: "agent-1" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).not.toThrow();
  });

  test("enforces the acting agent's granted role once a ledger entry is found", async () => {
    const { run } = await emptyGrantRun("command-authority-ledger-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "agent-1",
          role: "validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, agent: "agent-1" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).toThrow("may not invoke");
    expect(() => assertGrantedCommand(spec("run:exec"), flags)).toThrow("may not invoke");
  });

  test("enforces prohibited tools and execution categories on cognitive validators", async () => {
    const { run } = await emptyGrantRun("command-authority-tool-ban-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "val-1",
          role: "validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const toolCatFlags: Flags = { run, validator: "val-1", "tool-category": "shell" };
    expect(() => assertGrantedCommand(spec("task:probe"), toolCatFlags)).toThrow(
      "may not invoke execution tool category",
    );

    const toolFlags: Flags = { run, validator: "val-1", tool: "bash" };
    expect(() => assertGrantedCommand(spec("task:probe"), toolFlags)).toThrow(
      "may not invoke execution tool",
    );
  });

  test("enforces hierarchical supervision rules on agent:register", async () => {
    const { run } = await emptyGrantRun("command-authority-register-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "coord-1",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    // Spawning Tier 3 worker with parent coordinator succeeds
    const validRegister: Flags = {
      run,
      actor: "coord-1",
      "parent-agent": "coord-1",
      role: "implementer",
      agent: "impl-1",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), validRegister)).not.toThrow();

    // Spawning without parent when tier > 1 throws
    const unparentedTier3: Flags = {
      run,
      actor: "coord-1",
      role: "implementer",
      agent: "impl-2",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), unparentedTier3)).toThrow(
      "cannot be dispatched without a supervising parent agent",
    );

    // Spawning Tier 1 orchestrator without parent is allowed
    const unparentedTier1: Flags = {
      run,
      actor: "coord-1",
      role: "orchestrator",
      agent: "orch-1",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), unparentedTier1)).not.toThrow();
  });

  test("excludes a command's own subject flag from the candidates it reads the acting agent from", () => {
    const flags: Flags = { run: "/nonexistent/capsule", actor: "coordinator" };
    expect(() => assertGrantedCommand(spec("queue:pop"), flags)).not.toThrow();
  });

  test("verifies zero TypeScript any and zero suppressions across command authority files", () => {
    const filesToAudit = [
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority.ts",
      "/Users/onurseckinsenoglu/repos/skills/tests/unit/packets/command-authority.test.ts",
    ];

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

    for (const filePath of filesToAudit) {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
