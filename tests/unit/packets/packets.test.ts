import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/render-packet.ts";
import { persistPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/persist-packet.ts";
import { tokenDigest } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";

const commonBytes = new TextEncoder().encode("Preserve unrelated changes. Run focused tests.");
const clock = at("2026-08-13T12:00:00.000Z");
const base = () => {
  const claim = claimTask(new TestPort(workflowState()), "T-1", "agent", "implementer", {
    clock,
  });
  return {
    runId: "run-1",
    graphRevision: 2,
    agentId: "agent",
    attempt: 1,
    state: claim.state,
    task: claim.state.tasks["T-1"],
    commonInstructions: {
      bytes: commonBytes,
      sha256: createHash("sha256").update(commonBytes).digest("hex"),
    },
    roleInstructions: "Inspect authoritative evidence.",
    evidenceSchema: { required: ["evidence"] },
    targetedCommands: [["bun", "test"]],
    leaseToken: claim.token,
    clock,
    authoritativeContext: {
      ...inspectionContext(),
      mapped_requirements: [{ id: "R-1" }],
      task_contract: { id: "T-1" },
      implementer_report: "I am done",
      confidence: "high",
      decision_narrative: "trust me",
      previous_review_notes: "prior validator said pass",
      nested: { report: "hidden" },
    },
  };
};

function authorizeValidator(input: ReturnType<typeof base>): void {
  const token = "validation-token";
  input.agentId = "validator";
  input.leaseToken = token;
  input.task!.status = "validating";
  delete input.task!.lease;
  input.task!.validation = {
    validator_id: "validator",
    token_digest: tokenDigest(token),
    attempt: 1,
    started_at: "2026-08-13T12:00:00.000Z",
    deadline_at: "2026-08-13T12:20:00.000Z",
  };
}

describe("role packets", () => {
  test("appends common instructions and hashes content", () => {
    const packet = buildPacket({ ...base(), role: "implementer" });
    expect(packet.markdown).toContain("Preserve unrelated changes");
    expect(packet.metadata.packet_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(packet.metadata.requirement_ids).toEqual(["R-1"]);
  });

  test("isolates validator context from implementer and prior-review influence", () => {
    const input = base();
    authorizeValidator(input);
    const packet = buildPacket({ ...input, role: "validator" });
    for (const forbidden of ["I am done", "high", "trust me", "prior validator", "hidden"]) {
      expect(packet.markdown).not.toContain(forbidden);
    }
    expect(packet.markdown).toContain('"mapped_requirements"');
    expect(packet.metadata.excluded_fields).toContain("implementer_report");
  });

  test("repair packets retain the original task and assignee context", () => {
    const input = base();
    input.task!.original_implementer = "author-agent";
    input.agentId = "author-agent";
    input.task!.lease!.agent_id = "author-agent";
    input.task!.lease!.role = "repairer";
    const packet = buildPacket({
      ...input,
      role: "repairer",
      agentId: "author-agent",
      authoritativeContext: {
        ...inspectionContext(),
        task: input.task!,
        findings: [{ id: "F-1" }],
      },
    });
    expect(packet.metadata.agent_id).toBe("author-agent");
    expect(packet.markdown).toContain("F-1");
  });

  test("persists packets immutably", async () => {
    const root = await mkdtemp(join(tmpdir(), "harness-packets-"));
    const packet = buildPacket({
      ...base(),
      role: "planner",
      task: undefined,
      leaseToken: undefined,
    });
    const path = await persistPacket(root, "packet-1", packet);
    expect(await readFile(path, "utf8")).toBe(packet.markdown);
    await expect(persistPacket(root, "packet-1", packet)).rejects.toBeDefined();
  });
});
