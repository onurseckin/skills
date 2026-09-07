import { describe, expect, test } from "bun:test";
import {
  inferRoleFromAgentId,
  isCoordinatorRole,
  isOrchestratorRole,
  isSupervisoryRole,
  normalizeRoleName,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import {
  matchesBoundaryPrefix,
  matchesBoundarySuffix,
} from "../../../olt/scripts/src/authority/thread/role-inference.ts";

describe("role-inference regression guard and boundary safety", () => {
  test("inferRoleFromAgentId enforces boundary safety and prevents privilege escalation", () => {
    expect(inferRoleFromAgentId("orchid-helper-3")).toBeNull();
    expect(inferRoleFromAgentId("orchid")).toBeNull();
    expect(inferRoleFromAgentId("orchestration-log")).toBeNull();
    expect(inferRoleFromAgentId("coordinates-service")).toBeNull();
    expect(inferRoleFromAgentId("coordinates")).toBeNull();
    expect(inferRoleFromAgentId("coordinator2")).toBeNull();
    expect(inferRoleFromAgentId("auditor")).toBeNull();
    expect(inferRoleFromAgentId("auditor-1")).toBeNull();

    expect(inferRoleFromAgentId("orch-1")).toBe("orchestrator");
    expect(inferRoleFromAgentId("orch_exec")).toBe("orchestrator");
    expect(inferRoleFromAgentId("orch")).toBe("orchestrator");
    expect(inferRoleFromAgentId("orchestrator-pulse")).toBe("orchestrator");
    expect(inferRoleFromAgentId("orchestrator")).toBe("orchestrator");

    expect(inferRoleFromAgentId("coord-1")).toBe("coordinator");
    expect(inferRoleFromAgentId("coord_exec")).toBe("coordinator");
    expect(inferRoleFromAgentId("coord")).toBe("coordinator");
    expect(inferRoleFromAgentId("coordinator-pulse")).toBe("coordinator");
    expect(inferRoleFromAgentId("coordinator")).toBe("coordinator");

    expect(inferRoleFromAgentId("mind-pulse")).toBe("mind");
    expect(inferRoleFromAgentId("mind")).toBe("mind");
    expect(inferRoleFromAgentId("mindfulness")).toBeNull();

    expect(inferRoleFromAgentId("mind-auditor-1")).toBe("mind-auditor");
    expect(inferRoleFromAgentId("skill-auditor-1")).toBe("skill-auditor");

    expect(inferRoleFromAgentId("ui-headless-validator-lane")).toBe("ui-headless-validator");
    expect(inferRoleFromAgentId("ui-optical-validator-lane")).toBe("ui-optical-validator");

    expect(inferRoleFromAgentId("impl-1")).toBe("implementer");
    expect(inferRoleFromAgentId("implementer-1")).toBe("implementer");
    expect(inferRoleFromAgentId("val-1")).toBe("validator");
    expect(inferRoleFromAgentId("validator-1")).toBe("validator");

    expect(inferRoleFromAgentId("")).toBeNull();
    expect(inferRoleFromAgentId("   ")).toBeNull();
  });

  test("normalizeRoleName strictly accepts only canonical role names and rejects aliases", () => {
    expect(normalizeRoleName("orch")).toBeNull();
    expect(normalizeRoleName("coord")).toBeNull();
    expect(normalizeRoleName("worker")).toBeNull();
    expect(normalizeRoleName("critic")).toBeNull();
    expect(normalizeRoleName("orchid")).toBeNull();
    expect(normalizeRoleName("coordinates")).toBeNull();
    expect(normalizeRoleName("tier-0")).toBeNull();
    expect(normalizeRoleName("tier-1")).toBeNull();
    expect(normalizeRoleName("human")).toBeNull();

    expect(normalizeRoleName("orchestrator")).toBe("orchestrator");
    expect(normalizeRoleName("ORCHESTRATOR")).toBe("orchestrator");
    expect(normalizeRoleName(" coordinator ")).toBe("coordinator");
    expect(normalizeRoleName("mind")).toBe("mind");
    expect(normalizeRoleName("mind-auditor")).toBe("mind-auditor");
    expect(normalizeRoleName("skill-auditor")).toBe("skill-auditor");
    expect(normalizeRoleName("implementer")).toBe("implementer");
    expect(normalizeRoleName("validator")).toBe("validator");
    expect(normalizeRoleName("ui-headless-validator")).toBe("ui-headless-validator");
    expect(normalizeRoleName("ui-optical-validator")).toBe("ui-optical-validator");
    expect(normalizeRoleName("completeness-critic")).toBe("completeness-critic");
    expect(normalizeRoleName("planner")).toBe("planner");
    expect(normalizeRoleName("plan-validator")).toBe("plan-validator");
    expect(normalizeRoleName("sub-implementer")).toBe("sub-implementer");
    expect(normalizeRoleName("sub-validator")).toBe("sub-validator");
    expect(normalizeRoleName("sub-investigator")).toBe("sub-investigator");

    expect(normalizeRoleName("")).toBeNull();
    expect(normalizeRoleName("unknown-role")).toBeNull();
  });

  test("isOrchestratorRole correctly identifies orchestrator roles and rejects non-orchestrator roles", () => {
    expect(isOrchestratorRole("orchestrator")).toBe(true);
    expect(isOrchestratorRole("orch")).toBe(true);
    expect(isOrchestratorRole("orch-1")).toBe(true);
    expect(isOrchestratorRole("orch_exec")).toBe(true);

    expect(isOrchestratorRole("orchid")).toBe(false);
    expect(isOrchestratorRole("orchid-helper-3")).toBe(false);
    expect(isOrchestratorRole("coordinator")).toBe(false);
    expect(isOrchestratorRole("implementer")).toBe(false);
    expect(isOrchestratorRole("unknown")).toBe(false);
  });

  test("isCoordinatorRole correctly identifies coordinator roles and rejects non-coordinator roles", () => {
    expect(isCoordinatorRole("coordinator")).toBe(true);
    expect(isCoordinatorRole("coord")).toBe(true);
    expect(isCoordinatorRole("coord-1")).toBe(true);
    expect(isCoordinatorRole("coord_exec")).toBe(true);

    expect(isCoordinatorRole("coordinates")).toBe(false);
    expect(isCoordinatorRole("coordinates-service")).toBe(false);
    expect(isCoordinatorRole("orchestrator")).toBe(false);
    expect(isCoordinatorRole("implementer")).toBe(false);
  });

  test("isSupervisoryRole correctly identifies supervisory roles and rejects non-supervisory roles", () => {
    expect(isSupervisoryRole("mind")).toBe(true);
    expect(isSupervisoryRole("orchestrator")).toBe(true);
    expect(isSupervisoryRole("coordinator")).toBe(true);
    expect(isSupervisoryRole("orch-1")).toBe(true);
    expect(isSupervisoryRole("coord-1")).toBe(true);

    expect(isSupervisoryRole("implementer")).toBe(false);
    expect(isSupervisoryRole("validator")).toBe(false);
    expect(isSupervisoryRole("orchid")).toBe(false);
    expect(isSupervisoryRole("coordinates")).toBe(false);
  });

  test("boundary matching supports both prefix and suffix boundaries while rejecting substrings", () => {
    expect(matchesBoundaryPrefix("coordinator", "coordinator")).toBe(true);
    expect(matchesBoundaryPrefix("coord-1", "coord")).toBe(true);
    expect(matchesBoundaryPrefix("coord_infra", "coord")).toBe(true);
    expect(matchesBoundaryPrefix("feature-coordinator", "coordinator")).toBe(false);
    expect(matchesBoundaryPrefix("domain-coordinator", "coordinator")).toBe(false);
    expect(matchesBoundaryPrefix("coordinates", "coord")).toBe(false);
    expect(matchesBoundaryPrefix("coordinates-service", "coord")).toBe(false);
    expect(matchesBoundaryPrefix("coordinatorish", "coordinator")).toBe(false);
    expect(matchesBoundaryPrefix("notacoordinator", "coordinator")).toBe(false);
    expect(matchesBoundaryPrefix("uncoordinated", "coord")).toBe(false);

    expect(matchesBoundarySuffix("coordinator", "coordinator")).toBe(true);
    expect(matchesBoundarySuffix("feature-coordinator", "coordinator")).toBe(true);
    expect(matchesBoundarySuffix("domain-coordinator", "coordinator")).toBe(true);
    expect(matchesBoundarySuffix("coord-1", "coord")).toBe(false);
    expect(matchesBoundarySuffix("coord_infra", "coord")).toBe(false);
    expect(matchesBoundarySuffix("coordinates", "coord")).toBe(false);
    expect(matchesBoundarySuffix("coordinates-service", "coord")).toBe(false);
    expect(matchesBoundarySuffix("coordinatorish", "coordinator")).toBe(false);
    expect(matchesBoundarySuffix("notacoordinator", "coordinator")).toBe(false);
    expect(matchesBoundarySuffix("uncoordinated", "coord")).toBe(false);

    expect(matchesBoundaryPrefix("orch-1", "orch")).toBe(true);
    expect(matchesBoundaryPrefix("orch_exec", "orch")).toBe(true);
    expect(matchesBoundaryPrefix("domain-orchestrator", "orchestrator")).toBe(false);
    expect(matchesBoundaryPrefix("orchid", "orch")).toBe(false);
    expect(matchesBoundaryPrefix("orchid-helper-3", "orch")).toBe(false);
    expect(matchesBoundaryPrefix("orchestration-log", "orch")).toBe(false);

    expect(matchesBoundarySuffix("domain-orchestrator", "orchestrator")).toBe(true);
    expect(matchesBoundarySuffix("orch-1", "orch")).toBe(false);
    expect(matchesBoundarySuffix("orch_exec", "orch")).toBe(false);
    expect(matchesBoundarySuffix("orchid", "orch")).toBe(false);
    expect(matchesBoundarySuffix("orchid-helper-3", "orch")).toBe(false);
    expect(matchesBoundarySuffix("orchestration-log", "orch")).toBe(false);

    expect(inferRoleFromAgentId("coordinator")).toBe("coordinator");
    expect(inferRoleFromAgentId("coord-1")).toBe("coordinator");
    expect(inferRoleFromAgentId("coord_infra")).toBe("coordinator");
    expect(inferRoleFromAgentId("feature-coordinator")).toBe("coordinator");
    expect(inferRoleFromAgentId("domain-coordinator")).toBe("coordinator");

    expect(isCoordinatorRole("coordinator")).toBe(true);
    expect(isCoordinatorRole("coord-1")).toBe(true);
    expect(isCoordinatorRole("coord_infra")).toBe(true);
    expect(isCoordinatorRole("feature-coordinator")).toBe(true);
    expect(isCoordinatorRole("domain-coordinator")).toBe(true);

    expect(inferRoleFromAgentId("coordinates")).toBeNull();
    expect(inferRoleFromAgentId("coordinates-service")).toBeNull();
    expect(inferRoleFromAgentId("coordinatorish")).toBeNull();
    expect(inferRoleFromAgentId("notacoordinator")).toBeNull();
    expect(inferRoleFromAgentId("uncoordinated")).toBeNull();

    expect(isCoordinatorRole("coordinates")).toBe(false);
    expect(isCoordinatorRole("coordinates-service")).toBe(false);
    expect(isCoordinatorRole("coordinatorish")).toBe(false);
    expect(isCoordinatorRole("notacoordinator")).toBe(false);
    expect(isCoordinatorRole("uncoordinated")).toBe(false);

    expect(inferRoleFromAgentId("domain-orchestrator")).toBe("orchestrator");
    expect(inferRoleFromAgentId("orch-1")).toBe("orchestrator");
    expect(inferRoleFromAgentId("orch_exec")).toBe("orchestrator");

    expect(isOrchestratorRole("domain-orchestrator")).toBe(true);
    expect(isOrchestratorRole("orch-1")).toBe(true);
    expect(isOrchestratorRole("orch_exec")).toBe(true);

    expect(inferRoleFromAgentId("orchid")).toBeNull();
    expect(inferRoleFromAgentId("orchid-helper-3")).toBeNull();
    expect(inferRoleFromAgentId("orchestration-log")).toBeNull();

    expect(isOrchestratorRole("orchid")).toBe(false);
    expect(isOrchestratorRole("orchid-helper-3")).toBe(false);
    expect(isOrchestratorRole("orchestration-log")).toBe(false);
  });
});
