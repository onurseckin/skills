import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPacket } from "../../../olt/scripts/src/packets/render-packet.ts";
import {
  createPacketBundle,
  verifyPacketBundle,
} from "../../../olt/scripts/src/packets/packet-bundle.ts";
import {
  isolateValidatorContext,
  excludeValidatorContamination,
  VALIDATOR_EXCLUSIONS,
} from "../../../olt/scripts/src/packets/validator-context.ts";
import { evidenceSchema } from "../../../olt/scripts/src/packets/evidence-schema.ts";
import { loadRoleContract } from "../../../olt/scripts/src/packets/role-contract.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";

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

describe("Decoupled Capsule Memory Architecture", () => {
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

  describe("Packet Bundle Storage & Metadata Decoupling", () => {
    test("createPacketBundle writes packet.md and metadata.json as decoupled files", async () => {
      const root = await mkdtemp(join(tmpdir(), "packet-bundle-test-"));
      roots.push(root);

      const { state, token } = baseTaskState();
      const built = buildPacket({
        runId: "run-bundle",
        graphRevision: 1,
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
        authoritativeContext: { ...inspectionContext() },
      });

      const paths = createPacketBundle(root, "packet-impl-1", built, false);
      expect(paths.markdownPath).toBe(join(root, "packet-impl-1", "packet.md"));
      expect(paths.metadataPath).toBe(join(root, "packet-impl-1", "metadata.json"));

      const readMarkdown = await readFile(paths.markdownPath, "utf-8");
      const readMetadataJson = JSON.parse(await readFile(paths.metadataPath, "utf-8"));

      expect(readMarkdown).toBe(built.markdown);
      expect(readMetadataJson).toEqual(built.metadata);

      // Verify bundle verification passes
      const verified = verifyPacketBundle(root, "packet-impl-1", built);
      expect(verified).toEqual(paths);
    });

    test("createPacketBundle enforces immutability and rejects mutation attempts", async () => {
      const root = await mkdtemp(join(tmpdir(), "packet-immutability-"));
      roots.push(root);

      const { state, token } = baseTaskState();
      const built1 = buildPacket({
        runId: "run-bundle",
        graphRevision: 1,
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
        authoritativeContext: { ...inspectionContext() },
      });

      createPacketBundle(root, "packet-static-1", built1, false);

      const built2 = {
        markdown: built1.markdown + "\nMutated content",
        metadata: { ...built1.metadata, version: 2 },
      };

      // Attempting to overwrite existing bundle with different content must throw
      expect(() => createPacketBundle(root, "packet-static-1", built2, false)).toThrow(
        /already exists/u,
      );
      expect(() => createPacketBundle(root, "packet-static-1", built2, true)).toThrow(
        /already exists/u,
      );
    });
  });

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

      expect(valPacket.markdown).toContain("## Responsibility checklist");
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

      expect(implPacket.markdown).toContain("## Responsibility checklist");
      expect(implPacket.markdown).toContain("Pre-flight verification");
      expect(implPacket.markdown).toContain("Exclusive write scope");
      expect(implPacket.markdown).toContain("Direct end-to-end implementation & tests");
      expect(implPacket.markdown).toContain("Strict static invariants");
      expect(implPacket.markdown).toContain("Mandatory test gate execution");
      expect(implPacket.markdown).toContain("Ultra-lean context & on-demand inspection");
      expect(implPacket.markdown).toContain("Structured evidence submission");
    });

    test("renders pointers to disk Capsule Memory with CLI command guidance", () => {
      const { state, token } = baseTaskState();
      const packet = buildPacket({
        runId: "run-p52-ptrs",
        graphRevision: 1,
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
        authoritativeContext: { ...inspectionContext() },
      });

      expect(packet.markdown).toContain("## Capsule memory on disk");
      expect(packet.markdown).toContain(
        "bun harness.ts report:task --run .capsules/run-p52-ptrs --task T-1",
      );
      expect(packet.markdown).toContain(
        "bun harness.ts stream:events --run .capsules/run-p52-ptrs",
      );
      expect(packet.markdown).toContain("bun harness.ts dag:view --run .capsules/run-p52-ptrs");
      expect(packet.markdown).toContain(
        "bun harness.ts gate:prove --run .capsules/run-p52-ptrs --task T-1",
      );
      expect(packet.markdown).toContain("bun harness.ts explain <ERROR_CODE>");
      expect(packet.markdown).toContain("bun harness.ts doctor --run .capsules/run-p52-ptrs");
      expect(packet.markdown).toContain(
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
