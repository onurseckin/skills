import { describe, expect, it } from "bun:test";
import {
  checkAntiBoundaryLeak,
  checkValidatorHardLock,
  checkSpawning,
  checkForbidden,
} from "../../../olt/scripts/src/mind/auditing/roles/rules/leaf-checks.ts";
import type { RoleBoundaryAction } from "../../../olt/scripts/src/mind/auditing/roles/rules/matrix.ts";

describe("Mind Auditing Leaf Checks Coverage Suite", () => {
  const ts = "2026-09-01T12:00:00.000Z";
  const act = (
    role: string,
    actionType: RoleBoundaryAction["actionType"],
    extra: Partial<RoleBoundaryAction> = {},
  ): RoleBoundaryAction => ({ agentId: "ag1", role, actionType, ...extra });

  describe("checkAntiBoundaryLeak", () => {
    it("flags validator file_write, code_write, and code edit tools", () => {
      const v1 = checkAntiBoundaryLeak(act("validator", "file_write"), 3, ts);
      expect(v1?.violationType).toBe("validator_code_writing");
      expect(v1?.severity).toBe("CRITICAL");

      const v2 = checkAntiBoundaryLeak(act("sub-validator", "code_write"), 3, ts);
      expect(v2?.violationType).toBe("validator_code_writing");

      const v3 = checkAntiBoundaryLeak(
        act("validator", "tool_use", { toolName: "replace_file_content" }),
        3,
        ts,
      );
      expect(v3?.violationType).toBe("validator_code_writing");

      expect(
        checkAntiBoundaryLeak(act("validator", "tool_use", { toolName: "view_file" }), 3, ts),
      ).toBeNull();
    });

    it("flags implementer self-grading validation commands and task:review", () => {
      const i1 = checkAntiBoundaryLeak(
        act("implementer", "command_exec", { argv: ["task:validate-start"] }),
        3,
        ts,
      );
      expect(i1?.violationType).toBe("implementer_self_grading");
      expect(i1?.severity).toBe("CRITICAL");

      const i2 = checkAntiBoundaryLeak(
        act("worker", "command_exec", { argv: ["task:review"] }),
        3,
        ts,
      );
      expect(i2?.violationType).toBe("implementer_self_grading");

      expect(
        checkAntiBoundaryLeak(act("implementer", "command_exec", { argv: ["git", "diff"] }), 3, ts),
      ).toBeNull();
      expect(
        checkAntiBoundaryLeak(act("coordinator", "command_exec", { argv: ["task:review"] }), 2, ts),
      ).toBeNull();
    });
  });

  describe("checkValidatorHardLock", () => {
    it("returns null for non-cognitive validator roles", () => {
      expect(checkValidatorHardLock(act("mechanic-validator", "test_run"), 3, ts)).toBeNull();
      expect(checkValidatorHardLock(act("implementer", "command_exec"), 3, ts)).toBeNull();
    });

    it("flags cognitive validator prohibited tools, tool categories, and execution actions", () => {
      const vTool = checkValidatorHardLock(
        act("validator", "tool_use", { toolName: "run_command" }),
        3,
        ts,
      );
      expect(vTool?.violationType).toBe("validator_hardlock_violation");

      const vCat = checkValidatorHardLock(
        act("ui-validator", "tool_use", { toolCategory: "shell" }),
        3,
        ts,
      );
      expect(vCat?.violationType).toBe("validator_hardlock_violation");

      expect(checkValidatorHardLock(act("validator-a", "command_exec"), 3, ts)?.violationType).toBe(
        "validator_hardlock_violation",
      );
      expect(checkValidatorHardLock(act("validator", "test_run"), 3, ts)?.violationType).toBe(
        "validator_hardlock_violation",
      );
      expect(checkValidatorHardLock(act("validator", "test_execution"), 3, ts)?.violationType).toBe(
        "validator_hardlock_violation",
      );
      expect(
        checkValidatorHardLock(
          act("validator", "tool_use", { toolName: "view_file", toolCategory: "inspect" }),
          3,
          ts,
        ),
      ).toBeNull();
    });
  });

  describe("checkSpawning", () => {
    it("returns null for non-spawning action types", () => {
      expect(checkSpawning(act("mind", "command_exec"), 0, ts)).toBeNull();
    });

    it("flags leaf spawning from tier 3 workers, implementers, and validators", () => {
      expect(checkSpawning(act("worker", "spawning"), 3, ts)?.violationType).toBe("leaf_spawning");
      expect(
        checkSpawning(act("implementer", "spawning"), undefined as unknown as number, ts)
          ?.violationType,
      ).toBe("leaf_spawning");
      expect(
        checkSpawning(act("validator", "spawning"), undefined as unknown as number, ts)
          ?.violationType,
      ).toBe("leaf_spawning");
    });

    it("validates hierarchy spawning across Tier 0, Tier 1, and Tier 2", () => {
      const s0 = checkSpawning(act("mind", "spawning", { targetRole: "coordinator" }), 0, ts);
      expect(s0?.violationType).toBe("cross_tier_spawning");
      expect(s0?.tier).toBe(0);

      expect(
        checkSpawning(act("mind", "spawning", { targetRole: "orchestrator" }), 0, ts),
      ).toBeNull();
      expect(checkSpawning(act("mind", "spawning"), 0, ts)).toBeNull();

      const s1 = checkSpawning(
        act("orchestrator", "spawning", { targetRole: "implementer" }),
        1,
        ts,
      );
      expect(s1?.violationType).toBe("cross_tier_spawning");
      expect(s1?.tier).toBe(1);

      expect(
        checkSpawning(act("orchestrator", "spawning", { targetRole: "coordinator" }), 1, ts),
      ).toBeNull();
      expect(checkSpawning(act("orchestrator", "spawning"), 1, ts)).toBeNull();

      expect(
        checkSpawning(act("coordinator", "spawning", { targetRole: "mind" }), 2, ts)?.violationType,
      ).toBe("cross_tier_spawning");
      expect(
        checkSpawning(act("coordinator", "spawning", { targetRole: "orchestrator" }), 2, ts)
          ?.violationType,
      ).toBe("cross_tier_spawning");
      expect(
        checkSpawning(act("coordinator", "spawning", { targetRole: "coordinator" }), 2, ts)
          ?.violationType,
      ).toBe("cross_tier_spawning");
      expect(
        checkSpawning(act("coordinator", "spawning", { targetRole: "implementer" }), 2, ts),
      ).toBeNull();
      expect(checkSpawning(act("coordinator", "spawning"), 2, ts)).toBeNull();
      expect(checkSpawning(act("other", "spawning"), 4, ts)).toBeNull();
    });
  });

  describe("checkForbidden", () => {
    it("flags forbidden orchestrator:run execution", () => {
      const f1 = checkForbidden(
        act("implementer", "command_exec", { argv: ["orchestrator:run"] }),
        3,
        ts,
      );
      expect(f1?.violationType).toBe("forbidden_command_execution");
      expect(f1?.severity).toBe("CRITICAL");
    });

    it("flags supervisory task:claim execution for tiers below 3, allowing tier 3", () => {
      const s0 = checkForbidden(
        act("mind", "command_exec", { argv: ["task:claim", "--id=t1"] }),
        0,
        ts,
      );
      expect(s0?.violationType).toBe("supervisory_task_claim");
      expect(s0?.severity).toBe("HIGH");

      expect(
        checkForbidden(act("orchestrator", "command_exec", { argv: ["task:claim"] }), 1, ts)
          ?.violationType,
      ).toBe("supervisory_task_claim");
      expect(
        checkForbidden(act("coordinator", "command_exec", { argv: ["task:claim"] }), 2, ts)
          ?.violationType,
      ).toBe("supervisory_task_claim");
      expect(
        checkForbidden(act("implementer", "command_exec", { argv: ["task:claim"] }), 3, ts),
      ).toBeNull();
      expect(
        checkForbidden(act("implementer", "command_exec", { argv: ["git", "status"] }), 3, ts),
      ).toBeNull();
      expect(checkForbidden(act("implementer", "command_exec"), 3, ts)).toBeNull();
    });
  });
});
