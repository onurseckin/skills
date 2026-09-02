import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import {
  VerbatimRoleInjector,
  type StagnationTelemetry,
} from "../../../olt/scripts/src/authority/verbatim-role-injector.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

describe("VerbatimRoleInjector Comprehensive Coverage", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  it("can be instantiated via constructor", () => {
    const injector = new VerbatimRoleInjector();
    expect(injector).toBeInstanceOf(VerbatimRoleInjector);
  });

  it("resolves manifest path and throws NOT_FOUND on non-existent role", () => {
    const mindPath = VerbatimRoleInjector.resolveManifestPath(REPO_ROOT, "mind");
    expect(mindPath.endsWith("mind.yaml")).toBe(true);

    try {
      VerbatimRoleInjector.resolveManifestPath(REPO_ROOT, "non_existent_role_xyz");
      expect(true).toBe(false);
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("NOT_FOUND");
    }
  });

  it("builds injection prompt for mind in Mode A and Mode B with owner charter", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/role-inj/injection";
    const oltDir = join(sandbox, ".olt");
    vfs.mkdirSync(oltDir, { recursive: true });
    vfs.writeFileSync(join(oltDir, "charter.yaml"), "charter: test-mind\n");
    const agentsDir = join(sandbox, "olt", "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });
    vfs.writeFileSync(join(agentsDir, "mind.yaml"), 'name: "mind"\nrole: "mind"\n');

    const telemModeA: StagnationTelemetry = {
      agentId: "mind-0",
      role: "mind",
      idleDurationSeconds: 150,
      pendingBacklogCount: 0,
      pendingPlanCount: 0,
      unresolvedDefectCount: 2,
    };
    const promptA = VerbatimRoleInjector.buildInjectionPrompt(sandbox, "mind", telemModeA);
    expect(promptA).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE");
    expect(promptA).toContain("OWNER MIND CHARTER (.olt/charter.yaml)");
    expect(promptA).toContain('name: "mind"');

    const telemModeB: StagnationTelemetry = {
      agentId: "mind-0",
      role: "mind",
      idleDurationSeconds: 130,
      pendingBacklogCount: 5,
      pendingPlanCount: 1,
      unresolvedDefectCount: 0,
    };
    const promptB = VerbatimRoleInjector.buildInjectionPrompt(sandbox, "mind", telemModeB);
    expect(promptB).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
    expect(promptB).toContain("Decompose and admit pending backlog items into execution waves");
  });

  it("builds injection prompt for non-mind role and handles charter.yml", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/role-inj/non-mind";
    const oltDir = join(sandbox, ".olt");
    vfs.mkdirSync(oltDir, { recursive: true });
    vfs.writeFileSync(join(oltDir, "charter.yml"), "charter: yml-charter\n");
    const agentsDir = join(sandbox, "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });
    vfs.writeFileSync(join(agentsDir, "worker.yaml"), 'name: "worker"\n');

    const telem: StagnationTelemetry = {
      agentId: "worker-1",
      role: "worker",
      idleDurationSeconds: 200,
      pendingBacklogCount: 3,
      pendingPlanCount: 0,
      unresolvedDefectCount: 1,
    };
    const prompt = VerbatimRoleInjector.buildInjectionPrompt(sandbox, "worker", telem);
    expect(prompt).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
    expect(prompt).toContain("Role: worker | Agent: worker-1");
    expect(prompt).not.toContain("OWNER MIND CHARTER");
  });

  it("builds mind initialization prompt with custom and default options", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/role-inj/mind-init";
    const agentsDir = join(sandbox, "olt", "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });
    vfs.writeFileSync(join(agentsDir, "mind.yaml"), 'name: "mind"\n');

    const defaultPrompt = VerbatimRoleInjector.buildMindInitializationPrompt(sandbox);
    expect(defaultPrompt).toContain("Mind ID: unknown | Generation: 1");
    expect(defaultPrompt).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE");

    const customPrompt = VerbatimRoleInjector.buildMindInitializationPrompt(sandbox, {
      mindId: "mind-prime",
      generation: 3,
      runRoot: "/runs/run-123",
      charterSourcePath: "/charter/main.yaml",
      pendingBacklogCount: 4,
      mode: "B",
    });
    expect(customPrompt).toContain(
      "Mind ID: mind-prime | Generation: 3 | Capsule Root: /runs/run-123 | Charter Source: /charter/main.yaml",
    );
    expect(customPrompt).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
  });

  it("builds general initialization prompt for mind and non-mind roles", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/role-inj/init-general";
    const agentsDir = join(sandbox, "olt", "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });
    vfs.writeFileSync(join(agentsDir, "mind.yaml"), 'name: "mind"\n');
    vfs.writeFileSync(join(agentsDir, "coordinator.yaml"), 'name: "coordinator"\n');

    const mindInit = VerbatimRoleInjector.buildInitializationPrompt(sandbox, "mind", {
      agentId: "mind-main",
      mode: "A",
    });
    expect(mindInit).toContain("MIND_INITIALIZATION_VERBATIM_MANIFEST_INJECTION");
    expect(mindInit).toContain("Mind ID: mind-main");

    const coordInit = VerbatimRoleInjector.buildInitializationPrompt(sandbox, "coordinator", {
      agentId: "coord-custom",
      runRoot: "/capsule/coord",
      taskId: "task-42",
    });
    expect(coordInit).toContain("SUPERVISORY ROLE INITIALIZATION: COORDINATOR");
    expect(coordInit).toContain(
      "Agent ID: coord-custom | Capsule Root: /capsule/coord | Task: task-42",
    );

    const defaultCoordInit = VerbatimRoleInjector.buildInitializationPrompt(sandbox, "coordinator");
    expect(defaultCoordInit).toContain("Agent ID: coordinator-1");
  });

  it("builds subagent system prompt with and without custom instructions", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/role-inj/subagent-system";
    const agentsDir = join(sandbox, "olt", "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });
    vfs.writeFileSync(join(agentsDir, "implementer.yaml"), 'name: "implementer"\n');

    const basicPrompt = VerbatimRoleInjector.buildSubagentSystemPrompt(sandbox, "implementer");
    expect(basicPrompt).toContain("[SUBAGENT_VERBATIM_SYSTEM_PROMPT: IMPLEMENTER]");
    expect(basicPrompt).not.toContain("ADDITIONAL INSTRUCTIONS:");

    const customizedPrompt = VerbatimRoleInjector.buildSubagentSystemPrompt(
      sandbox,
      "implementer",
      { customInstructions: "Strictly adhere to TDD rules." },
    );
    expect(customizedPrompt).toContain("ADDITIONAL INSTRUCTIONS:\nStrictly adhere to TDD rules.");
  });

  it("builds subagent dispatch prompt with task, writeScope, and anchorBriefing", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/role-inj/subagent-dispatch";
    const agentsDir = join(sandbox, "olt", "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });
    vfs.writeFileSync(join(agentsDir, "validator.yaml"), 'name: "validator"\n');

    const defaultDispatch = VerbatimRoleInjector.buildSubagentDispatchPrompt(
      sandbox,
      "validator",
      "Validate auth tokens",
    );
    expect(defaultDispatch).toContain("DISPATCH COORDINATES: Agent: validator-worker");
    expect(defaultDispatch).toContain("TASK PROMPT:\nValidate auth tokens");

    const fullDispatch = VerbatimRoleInjector.buildSubagentDispatchPrompt(
      sandbox,
      "validator",
      "Run mutation tests",
      {
        agentId: "val-agent-7",
        taskId: "task-mut-001",
        runRoot: "/runs/run-99",
        writeScope: ["src/tokens.ts", "tests/tokens.test.ts"],
        exactAnchorBriefing: "Focus on token expiry edge case.",
      },
    );
    expect(fullDispatch).toContain(
      "DISPATCH COORDINATES: Agent: val-agent-7 | Task: task-mut-001 | Capsule Root: /runs/run-99",
    );
    expect(fullDispatch).toContain(
      "ASSIGNED WRITE SCOPE:\n- src/tokens.ts\n- tests/tokens.test.ts",
    );
    expect(fullDispatch).toContain("EXACT-ANCHOR BRIEFING:\nFocus on token expiry edge case.");
  });
});
