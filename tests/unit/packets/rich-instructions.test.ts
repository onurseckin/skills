import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { AGENT_ROLES } from "../../../olt/scripts/src/core/contracts/packets.ts";
import { VALIDATOR_DOMAINS } from "../../../olt/scripts/src/core/contracts/workflow.ts";
import { evidenceSchema } from "../../../olt/scripts/src/packets/evidence-schema.ts";
import {
  loadChecklist,
  loadRoleContract,
  loadValidatorDomainContract,
} from "../../../olt/scripts/src/packets/role-contract.ts";
import { buildPacket } from "../../../olt/scripts/src/packets/render-packet.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "../workflow/test-port.ts";
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
    targetedCommands: [["bun", "test", "tests/unit/example.test.ts"]],
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

describe("Rich, Uncompromised Instructions in Packets", () => {
  describe("Universal Core Instructions & Role Contracts", () => {
    test("every agent packet receives universal common instructions verbatim", () => {
      const input = baseImplementer();
      const packet = buildPacket(input);

      expect(packet.markdown).toContain("## Common instructions");
      expect(packet.markdown).toContain("Treat the packet's write scope as an exclusive lease");
      expect(packet.markdown).toContain(
        "Never invoke a model-provider API, embed credentials, or shell out to an LLM client",
      );
      expect(packet.markdown).toContain("Do not manually rewrite authoritative capsule state");
      expect(packet.markdown).toContain(
        "Bearer credentials are delivered only through the host process",
      );
      expect(packet.metadata.common_instructions_sha256).toBe(commonSha256);
    });

    test.each(AGENT_ROLES)("loads complete uncompromised role contract for %s", (role) => {
      const contract = loadRoleContract(role);
      expect(contract.role).toBe(role);
      expect(contract.text.trim().length).toBeGreaterThan(0);
      expect(contract.may.length).toBeGreaterThan(0);
      expect(contract.must_not.length).toBeGreaterThan(0);
      expect(contract.commands.length).toBeGreaterThan(0);
      expect(contract.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    test("embeds uncompromised role contract into implementer packet", () => {
      const input = baseImplementer();
      const contract = loadRoleContract("implementer");
      const packet = buildPacket(input);

      expect(packet.markdown).toContain("## Role contract");
      expect(packet.markdown).toContain(contract.text.trim());
      expect(packet.metadata.role_contract_sha256).toBe(contract.sha256);
      expect(packet.metadata.role).toBe("implementer");
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

      expect(packet.markdown).toContain("## Role contract");
      expect(packet.markdown).toContain(contract.text.trim());
      expect(packet.metadata.role_contract_sha256).toBe(contract.sha256);
      expect(packet.metadata.role).toBe("planner");
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

      expect(packet.markdown).toContain("## Role contract");
      expect(packet.markdown).toContain(contract.text.trim());
      expect(packet.metadata.role_contract_sha256).toBe(contract.sha256);
      expect(packet.metadata.role).toBe("repairer");
    });
  });

  describe("UI Design Checklist & Multi-Viewport Verification Criteria", () => {
    test("validator-ui-design contract embeds 4-tier Viewport Resolution Matrix", () => {
      const contract = loadValidatorDomainContract("ui-design");
      expect(contract.role).toBe("validator");
      expect(contract.domain).toBe("ui-design");

      // Verify Viewport Matrix specifications
      expect(contract.text).toContain("Desktop-Wide (1920x1080)");
      expect(contract.text).toContain("Desktop (1440x900)");
      expect(contract.text).toContain("Tablet (768x1024)");
      expect(contract.text).toContain("Mobile (390x844)");

      // Verify prohibitions against single-viewport shortcuts
      expect(contract.text).toContain(
        "Approve any visual surface without testing across all 4 mandatory viewports",
      );
      expect(contract.text).toContain("Approve screenshot artifacts smaller than 1024 bytes");
    });

    test("validator-ui-design contract embeds quantitative perceptual & contrast metrics", () => {
      const contract = loadValidatorDomainContract("ui-design");

      // Quantitative APCA and WCAG contrast rules
      expect(contract.text).toContain("APCA lightness contrast");
      expect(contract.text).toContain("Lc >= 60");
      expect(contract.text).toContain("Lc >= 45");

      // DOM bounds & touch target size rules
      expect(contract.text).toContain("44x44px");

      // 4-pillar companion manifest verification
      expect(contract.text).toContain("geometry_tokens");
      expect(contract.text).toContain("interaction_states");
      expect(contract.text).toContain("perceptual_clarity");
      expect(contract.text).toContain("accessibility_tree");
    });

    test("validator-ui-design folds in complete standing checklist with all items", () => {
      const checklist = loadChecklist("ui-design");
      const contract = loadValidatorDomainContract("ui-design");

      expect(contract.text).toContain(`## Standing checklist: ${checklist.title}`);
      for (const item of checklist.items) {
        expect(contract.text).toContain(`## ${item.id}`);
        expect(contract.text).toContain(item.rule);
        expect(contract.text).toContain(item.rationale);
        expect(contract.text).toContain(item.howToCheck);
        expect(contract.text).toContain(`severity: ${item.severity}`);
      }

      // Check specific critical UI checklist items
      const itemIds = checklist.items.map((i) => i.id);
      expect(itemIds).toContain("UI-LAYOUT-001");
      expect(itemIds).toContain("UI-LAYOUT-002");
      expect(itemIds).toContain("UI-TYPE-001");
      expect(itemIds).toContain("UI-TYPE-002");
      expect(itemIds).toContain("UI-COLOR-001");
      expect(itemIds).toContain("UI-COLOR-002");
      expect(itemIds).toContain("UI-SPACE-001");
      expect(itemIds).toContain("UI-RESP-001");
      expect(itemIds).toContain("UI-RESP-002");
      expect(itemIds).toContain("UI-A11Y-001");
      expect(itemIds).toContain("UI-A11Y-002");
      expect(itemIds).toContain("UI-DARK-001");
    });

    test("all 5 validator domains fold in their complete checklists without stripping", () => {
      let totalChecklistItems = 0;
      for (const domain of VALIDATOR_DOMAINS) {
        const checklist = loadChecklist(domain);
        const domainContract = loadValidatorDomainContract(domain);

        expect(domainContract.text).toContain(checklist.title);
        expect(checklist.items.length).toBeGreaterThanOrEqual(38);
        totalChecklistItems += checklist.items.length;

        for (const item of checklist.items) {
          expect(domainContract.text).toContain(item.id);
        }
      }

      expect(totalChecklistItems).toBeGreaterThanOrEqual(225);
    });
  });

  describe("Job-Specific Acceptance Criteria & Manifest Schemas", () => {
    test("mapped requirements preserve full requirement statements and acceptance criteria", () => {
      const input = baseImplementer();
      input.state.requirements = [
        {
          id: "R-1",
          description: "Full UI redesign",
          acceptance_criteria: [
            "Criterion 1: 1920x1080 multi-column grid layout",
            "Criterion 2: Contrast ratio >= 4.5:1",
            "Criterion 3: Touch targets >= 44x44px",
            "Criterion 4: Screenshot byte proofs >= 1024B",
          ],
        },
      ];
      input.task!.requirement_ids = ["R-1"];

      const packet = buildPacket(input);
      expect(packet.markdown).toContain("## Mapped requirements");
      expect(packet.markdown).toContain("Criterion 1: 1920x1080 multi-column grid layout");
      expect(packet.markdown).toContain("Criterion 2: Contrast ratio >= 4.5:1");
      expect(packet.markdown).toContain("Criterion 3: Touch targets >= 44x44px");
      expect(packet.markdown).toContain("Criterion 4: Screenshot byte proofs >= 1024B");
    });

    test("renders complete uncorrupted evidence schema for each role", () => {
      for (const role of AGENT_ROLES) {
        const schema = evidenceSchema(role);
        expect(schema).toBeObject();
        expect(schema).toHaveProperty("gate_evidence");
        expect(schema).toHaveProperty("gate_evidence_limitations");

        if (role === "implementer" || role === "repairer" || role === "sub-implementer") {
          expect(schema).toHaveProperty("summary");
          expect(schema).toHaveProperty("requirement_ids");
          expect(schema).toHaveProperty("files_changed");
          expect(schema).toHaveProperty("checks");
          expect(schema).toHaveProperty("evidence");
        } else if (role === "validator" || role === "sub-validator") {
          expect(schema).toHaveProperty("verdict");
          expect(schema).toHaveProperty("requirement_ids");
          expect(schema).toHaveProperty("checks");
          expect(schema).toHaveProperty("findings");
          expect(schema).toHaveProperty("resolved_findings");
        } else if (role === "completeness-critic") {
          expect(schema).toHaveProperty("status");
          expect(schema).toHaveProperty("requirement_proofs");
          expect(schema).toHaveProperty("integrity_evidence");
          expect(schema).toHaveProperty("findings");
          expect(schema).toHaveProperty("residual_risks");
        }
      }
    });

    test("packet sha256 covers rendered markdown and changes if any instruction byte changes", () => {
      const input = baseImplementer();
      const packet1 = buildPacket(input);

      const tamperedCommon = new TextEncoder().encode(
        commonText + "\n15. Tampered instruction rule.",
      );
      const packet2 = buildPacket({
        ...input,
        commonInstructions: {
          bytes: tamperedCommon,
          sha256: createHash("sha256").update(tamperedCommon).digest("hex"),
        },
      });

      expect(packet1.metadata.packet_sha256).not.toBe(packet2.metadata.packet_sha256);
      expect(packet1.metadata.packet_sha256).toBe(
        createHash("sha256").update(packet1.markdown).digest("hex"),
      );
      expect(packet2.metadata.packet_sha256).toBe(
        createHash("sha256").update(packet2.markdown).digest("hex"),
      );
    });
  });
});
