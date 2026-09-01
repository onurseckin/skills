import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  initCapsuleRun,
  loadRun,
  transact,
} from "../../../../../olt/scripts/src/engine/store/index.ts";
import type { JsonObject } from "../../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { registerAgentGrant } from "../../../../../olt/scripts/src/workflow/agents/grants.ts";
import { stageSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

beforeEach(() => {
  setupVirtualCliFS();
});

afterEach(() => {
  cleanupVirtualCliFS();
});

function registerAgentDirect(run: string, agent: string, role: string, parentAgent?: string): void {
  stageSessionGrant({ runRoot: run, agentId: agent, role, host: "antigravity" });
  registerAgentGrant({
    runRoot: run,
    agentId: agent,
    role,
    parentAgentId: parentAgent ?? null,
    parentTaskId: null,
    host: "antigravity",
    authority: parentAgent
      ? { kind: "verified_parent", actorId: parentAgent }
      : { kind: "conditional_genesis" },
    maxAgents: 20,
    telemetry: {},
  });
}

function setupAuthorityRun(name: string): { repo: string; run: string } {
  const repo = `/virtual/cli/authority-${name}`;
  getVirtualCliFS().mkdirSync(repo, { recursive: true });
  const { runRoot } = initCapsuleRun(`authority-${name}`, { repo });
  const roster = [
    ["fixture-mind-root", "mind", undefined],
    ["fixture-orch-root", "orchestrator", "fixture-mind-root"],
    ["coordinator", "coordinator", "fixture-orch-root"],
    ["worker-1", "implementer", "coordinator"],
    ["worker-2", "implementer", "coordinator"],
    ["orch-pulse-master", "implementer", "coordinator"],
    ["coord-domain-backend", "implementer", "coordinator"],
  ] as const;
  for (const [agent, role, parent] of roster) {
    registerAgentDirect(runRoot, agent, role, parent);
  }
  transact(runRoot, "test-setup", "init-requirements", {}, (draft) => {
    draft.requirements = {
      requirements: [{ id: "req-core", label: "Core Requirement", disposition: "needs_authority" }],
    };
    draft.tasks = {
      "req-core": {
        id: "req-core",
        label: "Core Task",
        status: "ready",
        write_scope: ["tests/core"],
      },
    };
  });
  return { repo, run: runRoot };
}

function gateRequirement(run: string, requirementId: string): void {
  transact(run, "test-setup", "requirement-gated-for-test", {}, (draft) => {
    const document = (draft.requirements ?? {}) as JsonObject;
    const list = (document.requirements ?? []) as JsonObject[];
    const requirement = list.find((entry) => entry.id === requirementId);
    if (!requirement) throw new Error(`requirement ${requirementId} not found`);
    requirement.disposition = "needs_authority";
  });
}

describe("authority:decide", () => {
  test("grants a needs_authority requirement and records the decision", async () => {
    const { run } = await setupAuthorityRun("authority-cmd-grant");
    gateRequirement(run, "req-core");

    const decided = await execute([
      "authority:decide",
      "--run",
      run,
      "--requirement",
      "req-core",
      "--actor",
      "coordinator",
      "--decision",
      "grant",
      "--rationale",
      "The user approved this in the review thread.",
    ]);
    expect(String(decided.markdown)).toContain("### Authority Decision Recorded: `req-core`");
    expect(String(decided.markdown)).toContain("- **Decision**: GRANT");
    expect(decided.run_root).toBe(run);
    const requirement = decided.requirement as { disposition: string; authority_status: string };
    expect(requirement.disposition).toBe("needs_authority");
    expect(requirement.authority_status).toBe("granted");

    const persisted = loadRun(run).state.requirements as JsonObject;
    const list = persisted.requirements as JsonObject[];
    const stored = list.find((entry) => entry.id === "req-core") as JsonObject;
    expect(stored.authority_status).toBe("granted");
  });

  test("declines a needs_authority requirement and records the rationale", async () => {
    const { run } = await setupAuthorityRun("authority-cmd-decline");
    gateRequirement(run, "req-core");

    const decided = await execute([
      "authority:decide",
      "--run",
      run,
      "--requirement",
      "req-core",
      "--actor",
      "coordinator",
      "--decision",
      "decline",
      "--rationale",
      "Out of scope for this run.",
    ]);
    expect(String(decided.markdown)).toContain("- **Decision**: DECLINE");
    expect(String(decided.markdown)).toContain("- **Rationale**: Out of scope for this run.");
    const requirement = decided.requirement as { authority_status: string };
    expect(requirement.authority_status).toBe("declined");
  });

  test("throws HarnessError if requirement is not found in non-mind state", async () => {
    const { run } = await setupAuthorityRun("authority-cmd-notfound");

    await expect(
      execute([
        "authority:decide",
        "--run",
        run,
        "--requirement",
        "req-nonexistent",
        "--actor",
        "coordinator",
        "--decision",
        "grant",
        "--rationale",
        "Approving unknown requirement",
      ]),
    ).rejects.toThrow(HarnessError);
  });

  test("decides proposal in mind / candidates state", async () => {
    const { run } = await setupAuthorityRun("authority-cmd-mind");

    transact(run, "test-setup", "seed-candidate", {}, (draft) => {
      draft.candidates = [
        {
          id: "prop-auth-1",
          statement: "Add authentication middleware",
          status: "needs_authority",
          disposition: "needs_authority",
        },
      ];
    });

    const decided = await execute([
      "authority:decide",
      "--run",
      run,
      "--requirement",
      "prop-auth-1",
      "--actor",
      "coordinator",
      "--decision",
      "grant",
      "--rationale",
      "Approved by project lead",
    ]);

    expect(String(decided.markdown)).toContain("### Authority Decision Recorded: `prop-auth-1`");
    expect(String(decided.markdown)).toContain("- **Decision**: GRANT");
    expect(String(decided.markdown)).toContain("- **Candidate**: `prop-auth-1`");
    expect(decided.proposal).toBeDefined();
  });

  test("rejects a decision value that is neither grant nor decline", async () => {
    const { run } = await setupAuthorityRun("authority-cmd-invalid");
    gateRequirement(run, "req-core");

    await expect(
      execute([
        "authority:decide",
        "--run",
        run,
        "--requirement",
        "req-core",
        "--actor",
        "coordinator",
        "--decision",
        "maybe",
        "--rationale",
        "Not a real decision.",
      ]),
    ).rejects.toThrow("--decision must be grant or decline");
  });
});

describe("Mechanical Role Confinement in task:claim", () => {
  const confinementCases: readonly [string, string, string, string | undefined][] = [
    [
      "role-confinement-orch-role",
      "worker-1",
      "orchestrator",
      "Dispatch Tier 3 Implementers via invoke_subagent.",
    ],
    ["role-confinement-orch-agent", "orch-pulse-master", "implementer", undefined],
    [
      "role-confinement-coord-role",
      "worker-2",
      "coordinator",
      "Dispatch Tier 3 Implementers via invoke_subagent.",
    ],
    ["role-confinement-coord-agent", "coord-domain-backend", "implementer", undefined],
  ];

  test.each(confinementCases)(
    "strictly blocks %s (%s, %s)",
    async (fixtureName, agent, role, expectedFix) => {
      const { run } = await setupAuthorityRun(fixtureName);
      try {
        await execute([
          "task:claim",
          "--run",
          run,
          "--task",
          "req-core",
          "--agent",
          agent,
          "--role",
          role,
        ]);
        expect(true).toBeFalse();
      } catch (err: unknown) {
        const error = err as { code?: string; message: string; fix?: string };
        expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(error.message).toContain("mechanically confined from claiming code execution tasks");
        if (expectedFix) expect(error.fix).toBe(expectedFix);
      }
    },
  );
});
