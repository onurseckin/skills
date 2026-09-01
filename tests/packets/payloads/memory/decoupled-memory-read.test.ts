import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPacket } from "../../../../olt/scripts/src/packets/render-packet.ts";
import {
  createPacketBundle,
  verifyPacketBundle,
} from "../../../../olt/scripts/src/packets/packet-bundle.ts";
import {
  isolateValidatorContext,
  excludeValidatorContamination,
  VALIDATOR_EXCLUSIONS,
} from "../../../../olt/scripts/src/packets/validator-context.ts";
import { evidenceSchema } from "../../../../olt/scripts/src/packets/evidence-schema.ts";
import { loadRoleContract } from "../../../../olt/scripts/src/packets/role-contract.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../../../workflow/index.ts";
import { getCapsuleCliCommands } from "../../../../olt/scripts/src/packets/capsule-memory.ts";
import { inspectionContext } from "../slicing/inspection-fixture.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.length = 0;
});

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

describe("Decoupled Capsule Memory - Read & Sanitization", () => {
  describe("Absence of Raw Bloated Orchestration Metadata in Packet Markdown", () => {
    test("packet.md does not embed raw full dependency graph JSON or global event logs", () => {
      const { state, token } = baseTaskState();

      // Add a large complex graph and event log to state
      state.graph = {
        revision: 42,
        nodes: Array.from({ length: 50 }, (_, i) => ({ id: `task-${i}`, label: `Task ${i}` })),
        edges: Array.from({ length: 49 }, (_, i) => ({ from: `task-${i}`, to: `task-${i + 1}` })),
      };
      state.events = Array.from({ length: 100 }, (_, i) => ({
        event_id: `evt-${i}`,
        type: "state-mutation",
        data: { payload: `large-payload-${i}` },
      }));

      const packet = buildPacket({
        runId: "run-decoupled-1",
        graphRevision: 42,
        role: "implementer",
        agentId: "worker-1",
        attempt: 1,
        state,
        task: state.tasks["T-1"],
        commonInstructions: { bytes: commonBytes, sha256: commonSha256 },
        evidenceSchema: evidenceSchema("implementer"),
        targetedCommands: [["bun", "test"]],
        leaseToken: token,
        clock,
        authoritativeContext: {
          ...inspectionContext(),
          task_contract: { id: "T-1", write_scope: ["src/feature.ts"] },
          mapped_requirements: [{ id: "R-1", text: "Requirement 1" }],
        },
      });

      // The packet markdown should NOT contain the raw 50-node graph or the 100-event array
      expect(packet.markdown).not.toContain("large-payload-0");
      expect(packet.markdown).not.toContain("large-payload-99");
      expect(packet.markdown).not.toContain('"task-49"');

      // Instead, metadata holds the graph revision number, not the graph blob
      expect(packet.metadata.graph_revision).toBe(42);
    });

    test("packet.md decouples prior review narratives and implementer confidence", () => {
      const { state, token } = baseTaskState();
      const task = state.tasks["T-1"]!;
      task.status = "validating";
      delete task.lease;
      task.validations = [
        {
          validator_id: "val-1",
          domain: "code-quality",
          token_digest: createHash("sha256").update("val-token").digest("hex"),
          attempt: 1,
          started_at: clock.now().toISOString(),
          deadline_at: "2026-08-13T12:20:00.000Z",
        },
      ];

      const bloatedContext = {
        ...inspectionContext(),
        implementer_report: "I tested everything manually and it is 100% flawless.",
        confidence: "very high",
        decision_narrative: "We bypassed standard checks because it looked obviously fine.",
        previous_review_notes: "Previous validator approved without running tests.",
        task_reports: ["historical report 1", "historical report 2"],
        validator_reports: ["old review report"],
        mapped_requirements: [{ id: "R-1" }],
        task_contract: { id: "T-1" },
      };

      const packet = buildPacket({
        runId: "run-decoupled-2",
        graphRevision: 1,
        role: "validator",
        agentId: "val-1",
        attempt: 1,
        state,
        task,
        commonInstructions: { bytes: commonBytes, sha256: commonSha256 },
        evidenceSchema: evidenceSchema("validator"),
        targetedCommands: [["bun", "test"]],
        leaseToken: "val-token",
        clock,
        authoritativeContext: bloatedContext,
      });

      // Assert all forbidden narrative/confidence strings are absent from rendered packet
      expect(packet.markdown).not.toContain("I tested everything manually");
      expect(packet.markdown).not.toContain("very high");
      expect(packet.markdown).not.toContain("bypassed standard checks");
      expect(packet.markdown).not.toContain("Previous validator approved");
      expect(packet.markdown).not.toContain("historical report 1");
      expect(packet.markdown).not.toContain("old review report");

      // Verify metadata tracks excluded fields
      expect(packet.metadata.excluded_fields).toContain("implementer_report");
      expect(packet.metadata.excluded_fields).toContain("confidence");
      expect(packet.metadata.excluded_fields).toContain("decision_narrative");
    });
  });

  describe("Validator Context Sanitization & Contamination Exclusion", () => {
    test("isolateValidatorContext keeps only allowed keys and strips all forbidden keys", () => {
      const raw = {
        baseline_repository_state: { sha256: "base" },
        current_repository_state: { sha256: "curr" },
        mapped_requirements: [{ id: "R-1" }],
        task_contract: { id: "T-1" },
        command_evidence: [{ id: "C-1" }],
        implementer_report: "forbidden report",
        confidence: "forbidden confidence",
        decision_narrative: "forbidden narrative",
        random_unauthorized_key: "forbidden unknown",
      };

      const isolated = isolateValidatorContext(raw);
      expect(isolated).toHaveProperty("baseline_repository_state");
      expect(isolated).toHaveProperty("current_repository_state");
      expect(isolated).toHaveProperty("mapped_requirements");
      expect(isolated).toHaveProperty("task_contract");
      expect(isolated).toHaveProperty("command_evidence");
      expect(isolated).not.toHaveProperty("implementer_report");
      expect(isolated).not.toHaveProperty("confidence");
      expect(isolated).not.toHaveProperty("decision_narrative");
      expect(isolated).not.toHaveProperty("random_unauthorized_key");
    });

    test("excludeValidatorContamination recursively sanitizes nested structures", () => {
      const nested = {
        id: "T-1",
        metadata: {
          confidence: "should-be-removed",
          nested_report: {
            task_report: "should-be-removed",
            valid_key: "should-be-kept",
          },
        },
        items: [
          { name: "item1", decision_narrative: "bad" },
          { name: "item2", valid_prop: 123 },
        ],
      };

      const sanitized = excludeValidatorContamination(nested) as Record<string, unknown>;
      expect(sanitized.id).toBe("T-1");
      const meta = sanitized.metadata as Record<string, unknown>;
      expect(meta).not.toHaveProperty("confidence");
      const sub = meta.nested_report as Record<string, unknown>;
      expect(sub).not.toHaveProperty("task_report");
      expect(sub.valid_key).toBe("should-be-kept");

      const items = sanitized.items as Record<string, unknown>[];
      expect(items[0]).not.toHaveProperty("decision_narrative");
      expect(items[0]!.name).toBe("item1");
      expect(items[1]!.valid_prop).toBe(123);
    });

    test("VALIDATOR_EXCLUSIONS includes comprehensive list of forbidden fields", () => {
      expect(VALIDATOR_EXCLUSIONS).toContain("confidence");
      expect(VALIDATOR_EXCLUSIONS).toContain("decision_narrative");
      expect(VALIDATOR_EXCLUSIONS).toContain("implementer_report");
      expect(VALIDATOR_EXCLUSIONS).toContain("implementer_reports");
      expect(VALIDATOR_EXCLUSIONS).toContain("previous_review");
      expect(VALIDATOR_EXCLUSIONS).toContain("previous_review_notes");
      expect(VALIDATOR_EXCLUSIONS).toContain("previous_reviews");
      expect(VALIDATOR_EXCLUSIONS).toContain("prior_review");
      expect(VALIDATOR_EXCLUSIONS).toContain("prior_reviews");
      expect(VALIDATOR_EXCLUSIONS).toContain("report");
      expect(VALIDATOR_EXCLUSIONS).toContain("task_report");
      expect(VALIDATOR_EXCLUSIONS).toContain("task_reports");
      expect(VALIDATOR_EXCLUSIONS).toContain("validator_report");
      expect(VALIDATOR_EXCLUSIONS).toContain("validator_reports");
    });
  });
});
