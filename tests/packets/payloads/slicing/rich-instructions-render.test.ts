import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { AGENT_ROLES } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { VALIDATOR_DOMAINS } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { evidenceSchema } from "../../../../olt/scripts/src/packets/evidence-schema.ts";
import {
  loadChecklist,
  loadRoleContract,
  loadValidatorDomainContract,
} from "../../../../olt/scripts/src/packets/role-contract.ts";
import { buildPacket, isUiTaskPacket } from "../../../../olt/scripts/src/packets/render-packet.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "../../../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";

const clock = at("2026-08-13T12:00:00.000Z");

const commonText = [
  "# Common agent instructions",
  "",
  "1. Follow system/developer instructions, the repository's checked-in agent guidance, and the immutable packet.",
  "2. Treat the packet's write scope as an exclusive lease.",
  "3. Inspect actual repository state before acting.",
  "4. Keep changes modular and context-sized.",
  "5. Execute commands as literal argv without a shell.",
  "6. Run only focused tests for the owned behavior.",
  "7. Use test-first work for behavior changes.",
  "8. Preserve public behavior unless the packet authorizes a contract change.",
  "9. Heartbeat before the lease expires.",
  "10. A task is not complete because code exists or tests were reported as green.",
  "11. Never invoke a model-provider API, embed credentials, or shell out to an LLM client.",
  "12. Do not manually rewrite authoritative capsule state.",
  "13. Bearer credentials are delivered only through the host process.",
  "14. Treat the packet's digest-bound repository inspection as authoritative starting evidence.",
].join("\n");

const commonBytes = new TextEncoder().encode(commonText);
const commonSha256 = createHash("sha256").update(commonBytes).digest("hex");

function baseImplementer() {
  const port = new TestPort(workflowState());
  const claim = claimTask(port, "T-1", "impl-agent", "implementer", { clock });
  return {
    runId: "run-test-rich",
    graphRevision: 1,
    role: "implementer" as const,
    agentId: "impl-agent",
    attempt: 1,
    state: claim.state,
    task: claim.state.tasks["T-1"],
    commonInstructions: {
      bytes: commonBytes,
      sha256: commonSha256,
    },
    evidenceSchema: evidenceSchema("implementer"),
    targetedCommands: [["bun", "test", "tests/example.test.ts"]],
    leaseToken: claim.token,
    clock,
    authoritativeContext: {
      ...inspectionContext(),
      mapped_requirements: [
        {
          id: "R-1",
          statement: "Implement multi-viewport responsive layout with high-contrast theme support",
          acceptance_criteria: [
            "Desktop-Wide (1920x1080) multi-column grid",
            "Desktop (1440x900) standard sidebar",
            "Tablet (768x1024) collapsible navigation",
            "Mobile (390x844) single-column touch view with 44px+ touch targets",
            "WCAG AA contrast >= 4.5:1 / APCA Lc >= 60",
            "Valid screenshot proof artifacts >= 1024 bytes",
          ],
        },
      ],
      task_contract: {
        id: "T-1",
        label: "UI Responsive Enhancement",
        write_scope: ["src/ui/responsive.tsx", "src/ui/theme.css"],
      },
    },
  };
}


describe("rich instructions - core & contracts", () => {
  describe("Universal Core Instructions & Role Contracts", () => {
    test("every agent packet receives universal common instructions verbatim", () => {
      const input = baseImplementer();
      const packet = buildPacket(input);

      expect(packet.metadata.common_instructions_sha256).toBe(commonSha256);
      expect(packet.markdown).toContain("# implementer packet");
      expect(packet.markdown).toContain("Actionable Task Checklist");
      expect(packet.markdown).toContain("Exclusive write scope");
    });

    test.each(AGENT_ROLES)("loads complete uncompromised role contract for %s", (role) => {
      const contract = loadRoleContract(role);
      expect(contract.role).toBe(role);
      expect(contract.text.trim().length).toBeGreaterThan(0);
      expect(contract.may.length).toBeGreaterThan(0);
      expect(contract.must_not.length).toBeGreaterThan(0);
      expect(contract.commands.length).toBeGreaterThan(0);
      if (role === "validator") {
        expect(contract.commands).not.toContain("run:exec");
      }
      expect(contract.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    test("embeds uncompromised role contract into implementer packet", () => {
      const input = baseImplementer();
      const contract = loadRoleContract("implementer");
      const packet = buildPacket(input);

      expect(packet.metadata.role_contract_sha256).toBe(contract.sha256);
      expect(packet.metadata.role).toBe("implementer");
      expect(packet.markdown).toContain("# implementer packet");
    });

    test("embeds uncompromised role contract into planner packet", () => {
      const port = new TestPort(workflowState());
      const contract = loadRoleContract("planner");
      const packet = buildPacket({
        runId: "run-planner",
        graphRevision: 1,
        role: "planner",
        agentId: "planner-agent",
        attempt: 1,
        state: port.read(),
        commonInstructions: {
          bytes: commonBytes,
          sha256: commonSha256,
        },
        evidenceSchema: evidenceSchema("planner"),
        targetedCommands: [["bun", "harness.ts", "plan:status"]],
        planningWriteScope: ["planning/requirements.json", "planning/graph.json"],
        clock,
        authoritativeContext: {
          original_prompt: "Build feature",
        },
      });

      expect(packet.metadata.role_contract_sha256).toBe(contract.sha256);
      expect(packet.metadata.role).toBe("planner");
      expect(packet.markdown).toContain("# planner packet");
    });

    test("embeds uncompromised role contract into repairer packet", () => {
      const input = baseImplementer();
      input.task!.original_implementer = "author-agent";
      input.agentId = "author-agent";
      input.task!.lease!.agent_id = "author-agent";
      input.task!.lease!.role = "repairer";
      registerTaskPacket(new TestPort(input.state), "implementer", "author-agent", 1);
      const contract = loadRoleContract("repairer");
      const packet = buildPacket({
        ...input,
        role: "repairer",
        agentId: "author-agent",
        evidenceSchema: evidenceSchema("repairer"),
        authoritativeContext: {
          ...inspectionContext(),
          findings: [{ id: "F-1", observation: "broken test" }],
        },
      });

      expect(packet.metadata.role_contract_sha256).toBe(contract.sha256);
      expect(packet.metadata.role).toBe("repairer");
      expect(packet.markdown).toContain("# repairer packet");
    });
  });

});
