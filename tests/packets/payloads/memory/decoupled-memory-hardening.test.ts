import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildPacket } from "../../../../olt/scripts/src/packets/render-packet.ts";
import {
  isolateValidatorContext,
  VALIDATOR_EXCLUSIONS,
} from "../../../../olt/scripts/src/packets/validator-context.ts";
import { evidenceSchema } from "../../../../olt/scripts/src/packets/evidence-schema.ts";
import { loadRoleContract } from "../../../../olt/scripts/src/packets/role-contract.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../../../workflow/index.ts";
import { getCapsuleCliCommands } from "../../../../olt/scripts/src/packets/capsule-memory.ts";
import { inspectionContext } from "../slicing/inspection-fixture.ts";

const clock = at("2026-08-13T12:00:00.000Z");
const commonBytes = new TextEncoder().encode("Canonical common instructions for tests.\n");
const commonSha256 = createHash("sha256").update(commonBytes).digest("hex");

function baseTaskState() {
  const port = new TestPort(workflowState());
  const claim = claimTask(port, "T-1", "worker-1", "implementer", { clock });
  return {
    state: claim.state,
    token: claim.token,
  };
}

describe("Decoupled Capsule Memory - Hardening & Exclusion", () => {
  describe("Task p52: Validator & Critic Hardening, Role Checklists & Memory Decoupling", () => {
    test("validator.md contract includes strict AGP definitions and review criteria", () => {
      const contract = loadRoleContract("validator");
      expect(contract.text).toContain("Adversarial Gate Proof (AGP) Protocol");
      expect(contract.text).toContain(
        "Anti-Rubber-Stamping & Direct End-to-End Command Verification",
      );
      expect(contract.text).toContain(
        "Strict Quantitative Metric Floors & Zero-Tolerance Invariants",
      );
      expect(contract.text).toContain("Prohibition of Fragmented Options & Partial Deliveries");
      expect(contract.must_not.join("\n")).toContain("superficial unit tests");
      expect(contract.must_not.join("\n")).toContain("Adversarial Gate Proofs (AGP)");
      expect(contract.may.join("\n")).toContain("Adversarial Gate Proofs (AGP)");
      expect(contract.may.join("\n")).toContain("direct end-to-end integration");
    });

    test("completeness-critic.md contract includes strict run-level AGP definitions and review criteria", () => {
      const contract = loadRoleContract("completeness-critic");
      expect(contract.text).toContain("Run-Level Adversarial Gate Proof (AGP) Protocol");
      expect(contract.text).toContain(
        "Anti-Rubber-Stamping & Direct End-to-End Requirement Proofs",
      );
      expect(contract.text).toContain("Strict Quantitative Invariants");
      expect(contract.text).toContain("Complete Feature Delivery & Unified CLI Surface");
      expect(contract.must_not.join("\n")).toContain("Adversarial Gate Proofs (AGP)");
      expect(contract.must_not.join("\n")).toContain("superficial unit tests");
      expect(contract.may.join("\n")).toContain("Adversarial Gate Proofs (AGP)");
      expect(contract.may.join("\n")).toContain("direct end-to-end command execution");
    });

    test("renders role-specific uncompromised responsibility checklists", () => {
      const { state, token } = baseTaskState();

      // Validator checklist
      const validatorTask = state.tasks["T-1"]!;
      validatorTask.status = "validating";
      delete validatorTask.lease;
      validatorTask.validations = [
        {
          validator_id: "val-1",
          domain: "code-quality",
          token_digest: createHash("sha256").update("val-token").digest("hex"),
          attempt: 1,
          started_at: clock.now().toISOString(),
          deadline_at: "2026-08-13T12:20:00.000Z",
        },
      ];

      const valPacket = buildPacket({
        runId: "run-p52-val",
        graphRevision: 1,
        role: "validator",
        agentId: "val-1",
        attempt: 1,
        state,
        task: validatorTask,
        commonInstructions: { bytes: commonBytes, sha256: commonSha256 },
        evidenceSchema: evidenceSchema("validator"),
        targetedCommands: [["bun", "test"]],
        leaseToken: "val-token",
        clock,
        authoritativeContext: { ...inspectionContext() },
      });

      expect(valPacket.markdown).toContain("## Actionable Task Checklist");
      expect(valPacket.markdown).toContain("Pre-flight verification & independence");
      expect(valPacket.markdown).toContain("Anti-rubber-stamping & direct validation");
      expect(valPacket.markdown).toContain("Adversarial Gate Proofs (AGP) & falsifiability");
      expect(valPacket.markdown).toContain("Direct end-to-end command verification");
      expect(valPacket.markdown).toContain("Strict quantitative metric floors");
      expect(valPacket.markdown).toContain("Anti-boundary-leak rule");
      expect(valPacket.markdown).toContain("Disk-backed evidence submission");

      // Implementer checklist
      const implState = baseTaskState();
      const implPacket = buildPacket({
        runId: "run-p52-impl",
        graphRevision: 1,
        role: "implementer",
        agentId: "worker-1",
        attempt: 1,
        state: implState.state,
        task: implState.state.tasks["T-1"],
        commonInstructions: { bytes: commonBytes, sha256: commonSha256 },
        evidenceSchema: evidenceSchema("implementer"),
        targetedCommands: [["bun", "test"]],
        leaseToken: implState.token,
        clock,
        authoritativeContext: { ...inspectionContext() },
      });

      expect(implPacket.markdown).toContain("## Actionable Task Checklist");
      expect(implPacket.markdown).toContain("Pre-flight verification");
      expect(implPacket.markdown).toContain("Exclusive write scope");
      expect(implPacket.markdown).toContain("Direct end-to-end implementation & tests");
      expect(implPacket.markdown).toContain("Strict static invariants");
      expect(implPacket.markdown).toContain("Mandatory test gate execution");
      expect(implPacket.markdown).toContain("Ultra-lean context & on-demand inspection");
      expect(implPacket.markdown).toContain("Structured evidence submission");
    });

    test("renders pointers to disk Capsule Memory with CLI command guidance", () => {
      const commands = getCapsuleCliCommands("run-p52-ptrs", "T-1");
      const cmdStrings = commands.map((c) => c.command);
      expect(cmdStrings).toContain(
        "bun harness.ts report:task --run .capsules/run-p52-ptrs --task T-1",
      );
      expect(cmdStrings).toContain("bun harness.ts stream:events --run .capsules/run-p52-ptrs");
      expect(cmdStrings).toContain("bun harness.ts dag:view --run .capsules/run-p52-ptrs");
      expect(cmdStrings).toContain(
        "bun harness.ts gate:prove --run .capsules/run-p52-ptrs --task T-1",
      );
      expect(cmdStrings).toContain("bun harness.ts explain <ERROR_CODE>");
      expect(cmdStrings).toContain("bun harness.ts doctor --run .capsules/run-p52-ptrs");
      expect(cmdStrings).toContain(
        "bun harness.ts evidence:get --run .capsules/run-p52-ptrs --evidence <ID>",
      );
    });

    test("sanitizes raw error blobs, stack traces, and unverified completion claims", () => {
      const bloated = {
        ...inspectionContext(),
        raw_errors: ["Error: Crash 1", "Error: Crash 2"],
        error_blobs: { error_1: "Trace 1", error_2: "Trace 2" },
        stack_traces: ["at foo()", "at bar()"],
        diagnostic_dumps: "huge diagnostic output",
        raw_telemetry: { cpu: 100, mem: 2048 },
        bulk_logs: "line 1\nline 2",
        hallucinated_completion: "Done without running tests",
        unverified_success: true,
        fake_completion: true,
        mapped_requirements: [{ id: "R-1" }],
        task_contract: { id: "T-1" },
      };

      const sanitized = isolateValidatorContext(bloated);
      expect(sanitized).not.toHaveProperty("raw_errors");
      expect(sanitized).not.toHaveProperty("error_blobs");
      expect(sanitized).not.toHaveProperty("stack_traces");
      expect(sanitized).not.toHaveProperty("diagnostic_dumps");
      expect(sanitized).not.toHaveProperty("raw_telemetry");
      expect(sanitized).not.toHaveProperty("bulk_logs");
      expect(sanitized).not.toHaveProperty("hallucinated_completion");
      expect(sanitized).not.toHaveProperty("unverified_success");
      expect(sanitized).not.toHaveProperty("fake_completion");

      expect(VALIDATOR_EXCLUSIONS).toContain("raw_errors");
      expect(VALIDATOR_EXCLUSIONS).toContain("error_blobs");
      expect(VALIDATOR_EXCLUSIONS).toContain("stack_traces");
      expect(VALIDATOR_EXCLUSIONS).toContain("diagnostic_dumps");
      expect(VALIDATOR_EXCLUSIONS).toContain("hallucinated_completion");
      expect(VALIDATOR_EXCLUSIONS).toContain("companion_manifest");
      expect(VALIDATOR_EXCLUSIONS).toContain("companion_manifests");
      expect(VALIDATOR_EXCLUSIONS).toContain("visual_report");
      expect(VALIDATOR_EXCLUSIONS).toContain("dom_report");
      expect(VALIDATOR_EXCLUSIONS).toContain("dom_metrics");
      expect(VALIDATOR_EXCLUSIONS).toContain("cognitive_questions");
      expect(VALIDATOR_EXCLUSIONS).toContain("cognitive_tree");
      expect(VALIDATOR_EXCLUSIONS).toContain("dom_physics");
      expect(VALIDATOR_EXCLUSIONS).toContain("layout_shifts");
    });
  });

  describe("Review Payload Gating & 4-Tier Companion Manifest Gating", () => {
    test("buildPacket prunes heavy companion manifests and visual artifacts on non-UI tasks", () => {
      const { state, token } = baseTaskState();
      const task = state.tasks["T-1"]!;
      task.write_scope = ["src/backend/engine.ts"];
      task.label = "Backend Calculation Engine";

      const heavyContext = {
        ...inspectionContext(),
        mapped_requirements: [{ id: "R-1" }],
        task_contract: { id: "T-1", write_scope: ["src/backend/engine.ts"] },
        companion_manifests: [
          {
            schema: "companion.manifest.v1",
            screenId: "preview",
            viewport: "desktop",
            criteria: Array.from({ length: 20 }, (_, i) => ({ id: `CRIT-${i}`, passed: true })),
          },
        ],
        visual_report: { schema: "visual.metrics.v1", viewports: [] },
        cognitive_questions: [{ id: "Q-1", passed: true }],
      };

      const packet = buildPacket({
        runId: "run-gated-1",
        graphRevision: 1,
        role: "implementer",
        agentId: "worker-1",
        attempt: 1,
        state,
        task,
        commonInstructions: { bytes: commonBytes, sha256: commonSha256 },
        evidenceSchema: evidenceSchema("implementer"),
        targetedCommands: [["bun", "test"]],
        leaseToken: token,
        clock,
        authoritativeContext: heavyContext,
      });

      expect(packet.markdown).not.toContain("companion.manifest.v1");
      expect(packet.markdown).not.toContain("visual.metrics.v1");
      expect(packet.markdown).not.toContain("CRIT-0");
      expect(packet.markdown).not.toContain("cognitive_questions");
    });
  });
});
