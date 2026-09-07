import { describe, expect, test } from "bun:test";
import { codesOf, collectEngineVerdicts, errorCodesOf, messagesOf, verdictOf } from "./harness.ts";

export const engineVerdictsPlanningSuiteName =
  "Doctor engine verdicts - planning graph, lease isolation and review quotas";

const ELEVEN_ENGINES: readonly string[] = [
  "checkPlanningDag",
  "checkAstPurity",
  "checkAntiMockMutation",
  "checkAntiBatchingIsolation",
  "checkDualChannelUi",
  "checkCognitiveValidatorCommandLock",
  "checkRoleBoundaryInterlock",
  "checkPushbackQuotas",
  "checkPolicyDoctor",
  "checkRepositoryHygiene",
  "checkGitIndexIntegrity",
];

describe(engineVerdictsPlanningSuiteName, () => {
  test("clean capsule and clean worktree produce a passing verdict from every engine", async () => {
    const verdicts = await collectEngineVerdicts({ label: "clean-baseline" });

    const failing = ELEVEN_ENGINES.filter((engine) => !verdictOf(verdicts, engine).passed);
    expect(failing).toEqual([]);

    const misidentified = ELEVEN_ENGINES.filter(
      (engine) => verdictOf(verdicts, engine).engine !== engine,
    );
    expect(misidentified).toEqual([]);

    const errorBearing = ELEVEN_ENGINES.filter(
      (engine) => errorCodesOf(verdicts, engine).length > 0,
    );
    expect(errorBearing).toEqual([]);
  });

  test("checkPlanningDag reports the cycle and the tier skip a defective graph carries", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "dag-cycle",
      shape: (state) => {
        state.tasks = {
          "task-one": {
            id: "task-one",
            status: "in_progress",
            assigned_agent: "implementer-one",
            write_scope: ["src/one/**"],
            dependencies: ["task-three"],
          },
          "task-two": {
            id: "task-two",
            status: "in_progress",
            assigned_agent: "implementer-two",
            write_scope: ["src/two/**"],
            dependencies: ["task-one"],
          },
          "task-three": {
            id: "task-three",
            status: "in_progress",
            assigned_agent: "implementer-three",
            write_scope: ["src/three/**"],
            dependencies: ["task-two", "task-absent"],
          },
        };
      },
    });

    const dag = verdictOf(verdicts, "checkPlanningDag");
    expect(dag.passed).toBe(false);
    expect(codesOf(verdicts, "checkPlanningDag")).toContain("PLANNING_DAG_CYCLE_DETECTED");
    expect(codesOf(verdicts, "checkPlanningDag")).toContain("PLANNING_DAG_MISSING_DEPENDENCY");
    expect(messagesOf(verdicts, "checkPlanningDag")).toContain("task-absent");

    expect(verdictOf(verdicts, "checkAntiBatchingIsolation").passed).toBe(true);
    expect(verdictOf(verdicts, "checkRepositoryHygiene").passed).toBe(true);
  });

  test("checkAntiBatchingIsolation reports duplicated leases and write scope collisions", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "batching-collision",
      shape: (state) => {
        state.tasks = {
          "task-one": {
            id: "task-one",
            status: "in_progress",
            assigned_agent: "implementer-overloaded",
            write_scope: ["src/shared/registry.ts"],
            dependencies: [],
          },
          "task-two": {
            id: "task-two",
            status: "in_progress",
            assigned_agent: "implementer-overloaded",
            write_scope: ["src/shared/**"],
            dependencies: ["task-one"],
          },
        };
      },
    });

    const batching = verdictOf(verdicts, "checkAntiBatchingIsolation");
    expect(batching.passed).toBe(false);
    expect(errorCodesOf(verdicts, "checkAntiBatchingIsolation")).toContain(
      "ANTI_BATCHING_MULTIPLE_ACTIVE_LEASES",
    );
    expect(errorCodesOf(verdicts, "checkAntiBatchingIsolation")).toContain(
      "ANTI_BATCHING_WRITE_SCOPE_COLLISION",
    );
    expect(messagesOf(verdicts, "checkAntiBatchingIsolation")).toContain("implementer-overloaded");

    expect(verdictOf(verdicts, "checkPlanningDag").passed).toBe(true);
  });

  test("checkPushbackQuotas reports probe and pushback deficits on a closed task", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "quota-deficit",
      shape: (state) => {
        state.tasks = {
          "task-closed": {
            id: "task-closed",
            status: "satisfied",
            assigned_agent: "implementer-closed",
            validator_agent: "reviewer-closed",
            dependencies: [],
            adversarial_probes: [1, 2],
            cognitive_pushbacks: [1],
          },
        };
      },
    });

    const quotas = verdictOf(verdicts, "checkPushbackQuotas");
    expect(quotas.passed).toBe(false);
    expect(errorCodesOf(verdicts, "checkPushbackQuotas")).toContain(
      "PUSHBACK_QUOTA_ADVERSARIAL_PROBES_DEFICIT",
    );
    expect(errorCodesOf(verdicts, "checkPushbackQuotas")).toContain(
      "PUSHBACK_QUOTA_COGNITIVE_PUSHBACKS_DEFICIT",
    );
    expect(messagesOf(verdicts, "checkPushbackQuotas")).toContain("2/5");

    expect(errorCodesOf(verdicts, "checkPolicyDoctor")).toContain(
      "PUSHBACK_QUOTA_ADVERSARIAL_PROBES_DEFICIT",
    );
  });
});
