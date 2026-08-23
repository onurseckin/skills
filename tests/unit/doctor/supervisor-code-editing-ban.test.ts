import { describe, expect, test } from "bun:test";
import {
  auditCoordinatorConfinement,
  auditOrchestratorConfinement,
  assertSupervisorRoleConfinement,
  type TierConfinementFinding,
} from "../../../olt/scripts/src/reporting/doctor/tier-confinement.ts";
import { whoamiCommand } from "../../../olt/scripts/src/cli/commands/whoami.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/agents.ts";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/commands.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";

describe("Mechanical Supervisor Code-Editing Ban & Doctor Enforcement (p46)", () => {
  test("auditOrchestratorConfinement flags critical finding when Orchestrator uses write tools", () => {
    const roleMap = new Map<string, string>([["orch-lead-1", "orchestrator"]]);
    const grants: AgentGrantRecord[] = [
      {
        id: "orch-lead-1",
        run_id: "run-1",
        role: "orchestrator",
        grant_issued_at: "2026-08-22T03:00:00.000Z",
        grant_expires_at: "2026-08-22T04:00:00.000Z",
        status: "active",
        tools_used: [
          {
            name: "write_to_file",
            category: "file-edit",
            first_used_at: "2026-08-22T03:05:00.000Z",
            last_used_at: "2026-08-22T03:05:00.000Z",
            count: 1,
          },
        ],
      },
    ];
    const commands: CommandRecord[] = [];
    const tasks: TaskRecord[] = [];
    const findings: TierConfinementFinding[] = [];

    auditOrchestratorConfinement(roleMap, grants, commands, tasks, findings);

    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("orchestrator_direct_implementation");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.observation).toContain("write_to_file");
  });

  test("auditCoordinatorConfinement flags critical finding when Coordinator uses replace_file_content", () => {
    const roleMap = new Map<string, string>([["coord-core-1", "coordinator"]]);
    const grants: AgentGrantRecord[] = [
      {
        id: "coord-core-1",
        run_id: "run-1",
        role: "coordinator",
        grant_issued_at: "2026-08-22T03:00:00.000Z",
        grant_expires_at: "2026-08-22T04:00:00.000Z",
        status: "active",
        tools_used: [
          {
            name: "replace_file_content",
            category: "file-edit",
            first_used_at: "2026-08-22T03:05:00.000Z",
            last_used_at: "2026-08-22T03:05:00.000Z",
            count: 1,
          },
        ],
      },
    ];
    const commands: CommandRecord[] = [];
    const tasks: TaskRecord[] = [];
    const findings: TierConfinementFinding[] = [];

    auditCoordinatorConfinement(roleMap, grants, commands, tasks, findings);

    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("coordinator_code_writing");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.observation).toContain("replace_file_content");
  });

  test("assertSupervisorRoleConfinement throws fatal SUPERVISOR_ROLE_CONTAMINATION error on findings", () => {
    const findings: TierConfinementFinding[] = [
      {
        agent_id: "orch-01",
        role: "orchestrator",
        tier: 1,
        violation_type: "orchestrator_direct_implementation",
        severity: "critical",
        observation: 'Tier 1 Orchestrator agent "orch-01" executed code editing tool directly',
        remediation: "Delegate coding exclusively to Tier 3 Implementers.",
      },
    ];

    try {
      assertSupervisorRoleConfinement(findings);
      expect(true).toBe(false); // unreachable
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBeTrue();
      if (err instanceof HarnessError) {
        expect(err.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(err.message).toContain("Supervisor code editing contamination detected");
      }
    }
  });

  test("assertSupervisorRoleConfinement passes cleanly when no supervisor code editing exists", () => {
    const findings: TierConfinementFinding[] = [
      {
        agent_id: "impl-01",
        role: "implementer",
        tier: 3,
        violation_type: "implementer_self_grading",
        severity: "important",
        observation: "Implementer tried self grading",
        remediation: "Review must be independent",
      },
    ];

    expect(() => assertSupervisorRoleConfinement(findings)).not.toThrow();
  });

  test("whoamiCommand outputs mechanical supervisor role boundary for Tier 1 and Tier 2", () => {
    const orchResult = whoamiCommand({ role: "orchestrator", tier: "1" });
    const orchMd = String(orchResult.markdown);
    expect(orchMd).toContain("SUPERVISOR ROLE DETECTED");
    expect(orchMd).toContain("strictly forbidden from calling code-editing tools");
    expect(orchMd).toContain("invoke_subagent");

    const coordResult = whoamiCommand({ role: "coordinator", tier: "2" });
    const coordMd = String(coordResult.markdown);
    expect(coordMd).toContain("SUPERVISOR ROLE DETECTED");
    expect(coordMd).toContain("strictly forbidden from calling code-editing tools");

    const implResult = whoamiCommand({ role: "implementer", tier: "3" });
    const implMd = String(implResult.markdown);
    expect(implMd).not.toContain("SUPERVISOR ROLE DETECTED");
  });
});
