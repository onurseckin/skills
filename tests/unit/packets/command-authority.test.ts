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
  test("denies a non-allowlisted command when run flag is absent or no acting agent is provided", () => {
    expect(() => assertGrantedCommand(spec("task:submit"), {})).toThrow(
      "not on the grant bootstrap allowlist",
    );
    expect(() => assertGrantedCommand(spec("task:submit"), { run: "/some/path" })).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });

  test("permits a bootstrap-allowlisted command with no run flag or no acting agent", () => {
    expect(() => assertGrantedCommand(spec("plan:init"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("agent:register"), { run: "/some/path" })).not.toThrow();
  });

  test("denies a non-allowlisted command when run state has no matching agent grant", async () => {
    const { run } = await emptyGrantRun("command-authority-no-grant-");
    expect(() =>
      assertGrantedCommand(spec("task:submit"), { run, agent: "unregistered-agent" }),
    ).toThrow("not on the grant bootstrap allowlist");
  });

  test("permits agent:register with no matching agent grant, the bootstrap case", async () => {
    const { run } = await emptyGrantRun("command-authority-register-bootstrap-");
    expect(() =>
      assertGrantedCommand(spec("agent:register"), { run, actor: "first-orchestrator" }),
    ).not.toThrow();
  });

  test("denies a non-allowlisted command against a state.json that does not belong to a real capsule", async () => {
    const { repo } = await emptyGrantRun("command-authority-broken-capsule-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    await writeFile(join(brokenRoot, "state.json"), "{}");
    const flags: Flags = { run: brokenRoot, agent: "agent-1" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).toThrow(
      "not on the grant bootstrap allowlist",
    );
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

    const tier3WorkerWithParentCoordinator: Flags = {
      run,
      actor: "coord-1",
      "parent-agent": "coord-1",
      role: "implementer",
      agent: "impl-1",
    };
    expect(() =>
      assertGrantedCommand(spec("agent:register"), tier3WorkerWithParentCoordinator),
    ).not.toThrow();

    const unparentedTier3: Flags = {
      run,
      actor: "coord-1",
      role: "implementer",
      agent: "impl-2",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), unparentedTier3)).toThrow(
      "cannot be dispatched without a supervising parent agent",
    );

    const unparentedTier1: Flags = {
      run,
      actor: "coord-1",
      role: "orchestrator",
      agent: "orch-1",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), unparentedTier1)).toThrow(
      "may only dispatch Tier 3 workers",
    );
  });

  test("CRITICAL 1: --parent-agent given but no acting identity resolves no longer bypasses the hierarchy check", async () => {
    const { run } = await emptyGrantRun("command-authority-critical1-repro-");
    const bootstrapOrchestrator: Flags = {
      run,
      agent: "orchestrator-1",
      role: "orchestrator",
      host: "claude-code",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), bootstrapOrchestrator)).not.toThrow();
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "orchestrator-1",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const noActorGiven: Flags = {
      run,
      agent: "impl-skip-tier",
      role: "implementer",
      host: "claude-code",
      "parent-agent": "orchestrator-1",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), noActorGiven)).toThrow(
      "may only dispatch Tier 2 Coordinators",
    );
  });

  test("HIGH 4: an unresolvable or inactive --parent-agent is an error, never a silent skip", async () => {
    const { run } = await emptyGrantRun("command-authority-high4-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "released-coord",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "released",
        },
      ];
    });

    const nonexistentParent: Flags = {
      run,
      agent: "impl-1",
      role: "implementer",
      host: "claude-code",
      "parent-agent": "ghost-parent-not-in-ledger",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), nonexistentParent)).toThrow(
      "does not resolve to any grant",
    );

    const inactiveParent: Flags = {
      run,
      agent: "impl-2",
      role: "implementer",
      host: "claude-code",
      "parent-agent": "released-coord",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), inactiveParent)).toThrow(
      "holds a released grant, not an active one",
    );
  });

  test("CRITICAL 2/HIGH 3: registering an unparented Tier 0/1 agent requires a resolvable, granted acting identity once genesis has passed", async () => {
    const { run } = await emptyGrantRun("command-authority-critical2-");
    expect(() =>
      assertGrantedCommand(spec("agent:register"), {
        run,
        agent: "mind-1",
        role: "mind",
        host: "claude-code",
      }),
    ).not.toThrow();
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    expect(() =>
      assertGrantedCommand(spec("agent:register"), {
        run,
        agent: "orchestrator-2",
        role: "orchestrator",
        host: "claude-code",
      }),
    ).toThrow("no resolvable acting identity");

    expect(() =>
      assertGrantedCommand(spec("agent:register"), {
        run,
        actor: "nobody-registered",
        agent: "orchestrator-3",
        role: "orchestrator",
        host: "claude-code",
      }),
    ).toThrow("holds no active grant in this run");

    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      const agents = Array.isArray(draft.agents) ? draft.agents : [];
      draft.agents = [
        ...agents,
        {
          id: "impl-escalator",
          role: "implementer",
          parent_agent_id: "mind-1",
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });
    expect(() =>
      assertGrantedCommand(spec("agent:register"), {
        run,
        actor: "impl-escalator",
        agent: "self-minted-mind",
        role: "mind",
        host: "claude-code",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      assertGrantedCommand(spec("agent:register"), {
        run,
        actor: "mind-1",
        agent: "orchestrator-legit",
        role: "orchestrator",
        host: "claude-code",
      }),
    ).not.toThrow();
  });

  test("HIGH 5: branch-worker roles are exempt from the tier ladder, but only for Tier 3 parents", () => {
    expect(() => assertHierarchicalSpawning("implementer", "sub-implementer")).toThrow(
      HarnessError,
    );
  });

  test("HIGH 5: a coordinator's declared spawns allowlist narrows what agent:register permits, even for a tier-legal role", async () => {
    const { run } = await emptyGrantRun("command-authority-high5-narrowing-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "coord-narrow",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const undeclaredButTierLegal: Flags = {
      run,
      agent: "repairer-1",
      role: "repairer",
      host: "claude-code",
      "parent-agent": "coord-narrow",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), undeclaredButTierLegal)).toThrow(
      "Declared spawn allowlist violation",
    );

    const declaredAndTierLegal: Flags = {
      run,
      agent: "impl-declared",
      role: "implementer",
      host: "claude-code",
      "parent-agent": "coord-narrow",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), declaredAndTierLegal)).not.toThrow();
  });

  test("excludes a command's own subject flag from the candidates it reads the acting agent from", async () => {
    const { run } = await emptyGrantRun("command-authority-subject-exclusion-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "coordinator-1",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, actor: "coordinator-1", agent: "not-a-real-agent" };
    expect(() => assertGrantedCommand(spec("queue:pop"), flags)).toThrow(
      "agent coordinator-1 holds a coordinator grant",
    );
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
