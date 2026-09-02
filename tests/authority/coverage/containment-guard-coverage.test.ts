import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertSupervisoryContainment,
  checkSupervisoryContainment,
  detectSupervisoryViolation,
  getDefaultContainmentEngine,
  isSupervisoryRoleForContainment,
  registerContainmentEngineFactory,
  resetDefaultContainmentEngine,
  setDefaultContainmentEngine,
  type ContainmentEngineLike,
  type ContainmentResult,
} from "../../../olt/scripts/src/authority/guards/containment.ts";

class TestEngine implements ContainmentEngineLike {
  public strikeCount = 0;
  public isTerminated = false;
  public revokedTools: readonly string[] = [];
  public permittedTools = new Set(["invoke_subagent", "msg:send"]);

  getAgentState(_agentId: string) {
    return {
      strikeCount: this.strikeCount,
      isTerminated: this.isTerminated,
      revokedTools: this.revokedTools,
    };
  }

  interceptAction(params: {
    readonly agentId: string;
    readonly role: string;
    readonly actionType:
      | "DIRECT_CODE_EDIT"
      | "DIRECT_TEST_RUN"
      | "DIRECT_MUTATION_COMMAND"
      | "BYPASS_DELEGATION"
      | "CRITIC_JOB_EXECUTION";
    readonly attemptedAction: string;
  }): ContainmentResult {
    this.strikeCount += 1;
    return {
      action: this.strikeCount >= 3 ? "PERSONA_RESPAWN" : "HALT_AND_DELEGATE",
      strikeLevel: this.strikeCount,
      blocked: true,
      message: `Violation ${params.actionType} strike ${this.strikeCount}`,
      revokedTools: this.revokedTools,
    };
  }

  isToolPermitted(_agentId: string, _role: string, toolName: string): boolean {
    return this.permittedTools.has(toolName);
  }
}

describe("containment-guard-coverage", () => {
  let engine: TestEngine;

  beforeEach(() => {
    resetDefaultContainmentEngine();
    engine = new TestEngine();
    setDefaultContainmentEngine(engine);
  });

  afterEach(() => {
    resetDefaultContainmentEngine();
  });

  it("handles engine lifecycle, registration, and fallback errors", () => {
    resetDefaultContainmentEngine();
    expect(() => getDefaultContainmentEngine()).toThrow(HarnessError);
    registerContainmentEngineFactory(() => new TestEngine());
    expect(getDefaultContainmentEngine()).toBeDefined();
    setDefaultContainmentEngine(engine);
    expect(getDefaultContainmentEngine()).toBe(engine);
  });

  it("evaluates supervisory role classification patterns", () => {
    const roles =
      "mind mind-supervisor tier-0 mind-auditor skill-auditor orchestrator domain-orchestrator orch tier-1 coordinator feature-coordinator domain-coordinator coord tier-2 orchestrator-alpha beta-orchestrator domain_orchestrator_sub coordinator-1 feature-coordinator-2 lead_supervisor".split(
        " ",
      );
    for (const r of roles) expect(isSupervisoryRoleForContainment(r)).toBe(true);
    for (const r of ["implementer", "worker", "validator", "tester"]) {
      expect(isSupervisoryRoleForContainment(r)).toBe(false);
    }
  });

  it("detects explicit action types and coordinator file edits", () => {
    expect(detectSupervisoryViolation({ role: "worker", command: "bun test" })).toBeNull();
    expect(
      detectSupervisoryViolation({ role: "coordinator", actionType: "BYPASS_DELEGATION" }),
    ).toEqual({ violationType: "BYPASS_DELEGATION", attemptedAction: "BYPASS_DELEGATION" });

    const exp2 = detectSupervisoryViolation({
      role: "coordinator",
      actionType: "DIRECT_TEST_RUN",
      command: "bun test",
    });
    expect(exp2?.attemptedAction).toBe("bun test");

    expect(detectSupervisoryViolation({ role: "coordinator", toolName: "write_to_file" })).toEqual({
      violationType: "DIRECT_CODE_EDIT",
      attemptedAction: "write_to_file",
    });
  });

  it("detects command violations for tests, mutations, delegation, and critic tasks", () => {
    const testCmds =
      "npm test|pnpm run test|yarn test|bun test|vitest|jest|pytest|cargo test|go test|npm run test:unit|npm run test:e2e".split(
        "|",
      );
    for (const cmd of testCmds) {
      expect(
        detectSupervisoryViolation({ role: "orchestrator", command: cmd })?.violationType,
      ).toBe("DIRECT_TEST_RUN");
    }

    const mutCmds =
      "git commit -m 'wip'|git push origin main|rm -rf ./tmp|cp a b|mv a b|mkdir -p dir|touch file.ts|sed -i 's/a/b/g' file.ts|awk -i file.ts".split(
        "|",
      );
    for (const cmd of mutCmds) {
      expect(detectSupervisoryViolation({ role: "mind", command: cmd })?.violationType).toBe(
        "DIRECT_MUTATION_COMMAND",
      );
    }

    for (const argv of [["task:claim", "1"], ["claim_task"], ["run", "lease_task"]]) {
      expect(detectSupervisoryViolation({ role: "coordinator", argv })?.violationType).toBe(
        "BYPASS_DELEGATION",
      );
    }

    for (const cmd of ["critic:review 1", "critic:reject 2", "exec critic:start 3"]) {
      expect(
        detectSupervisoryViolation({ role: "mind-supervisor", command: cmd })?.violationType,
      ).toBe("CRITIC_JOB_EXECUTION");
    }
  });

  it("detects target file heuristic edits and handles benign commands", () => {
    expect(
      detectSupervisoryViolation({
        role: "coordinator",
        toolName: "customwriter",
        targetFile: "src/a.ts",
      }),
    ).toEqual({
      violationType: "DIRECT_CODE_EDIT",
      attemptedAction: "customwriter -> src/a.ts",
    });

    expect(
      detectSupervisoryViolation({
        role: "coordinator",
        command: "echo 'hello'",
        toolName: "read_file",
      }),
    ).toBeNull();
  });

  it("enforces checkSupervisoryContainment and assertSupervisoryContainment logic", () => {
    expect(checkSupervisoryContainment({ agentId: "w1", role: "worker" }).blocked).toBe(false);

    engine.isTerminated = true;
    const termRes = checkSupervisoryContainment({ agentId: "m1", role: "mind" });
    expect(termRes.action).toBe("PERSONA_RESPAWN");
    expect(() => assertSupervisoryContainment({ agentId: "m1", role: "mind" })).toThrow(
      HarnessError,
    );

    engine.isTerminated = false;
    engine.strikeCount = 0;
    const vRes1 = checkSupervisoryContainment({
      agentId: "c1",
      role: "coordinator",
      command: "bun test",
    });
    expect(vRes1.blocked).toBe(true);
    expect(vRes1.strikeLevel).toBe(1);

    expect(() =>
      assertSupervisoryContainment({ agentId: "c1", role: "coordinator", command: "bun test" }),
    ).toThrow(HarnessError);

    engine.strikeCount = 2;
    expect(() =>
      assertSupervisoryContainment({ agentId: "c1", role: "coordinator", command: "bun test" }),
    ).toThrow(HarnessError);

    expect(
      checkSupervisoryContainment({
        agentId: "c2",
        role: "coordinator",
        toolName: "unauthorized_tool",
      }).action,
    ).toBe("CAPABILITY_REVOCATION");
    expect(() =>
      assertSupervisoryContainment({
        agentId: "c2",
        role: "coordinator",
        toolName: "unauthorized_tool",
      }),
    ).toThrow(HarnessError);

    expect(
      assertSupervisoryContainment({
        agentId: "c3",
        role: "coordinator",
        toolName: "invoke_subagent",
      }).blocked,
    ).toBe(false);
  });
});
