import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPacket } from "../../../olt/scripts/src/packets/render-packet.ts";
import { createPacketBundle } from "../../../olt/scripts/src/packets/packet-bundle.ts";
import { tokenDigest } from "../../../olt/scripts/src/workflow/lease/token.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../../workflow/index.ts";
import { inspectionContext } from "../payloads/slicing/inspection-fixture.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const vfs = new VirtualMemoryFS();
const session = createVirtualFSSession(vfs);

afterAll(() => {
  session.cleanup();
  vfs.reset();
});

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
  input.task!.validations = [
    {
      validator_id: "validator",
      domain: "code-quality",
      token_digest: tokenDigest(token),
      attempt: 1,
      started_at: "2026-08-13T12:00:00.000Z",
      deadline_at: "2026-08-13T12:20:00.000Z",
    },
  ];
}

describe("role packets", () => {
  test("appends common instructions and hashes content", () => {
    const packet = buildPacket({ ...base(), role: "implementer" });
    expect(packet.markdown).toContain("Actionable Task Checklist");
    expect(packet.markdown).toContain("Exclusive write scope");
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
    expect(packet.markdown).toContain('"requirement_ids"');
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
    expect(packet.markdown).toContain('"original_implementer": "author-agent"');
  });

  test("persists packets immutably", async () => {
    const root = `/virtual/harness-packets-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(root, { recursive: true });
    const packet = buildPacket({
      ...base(),
      role: "planner",
      task: undefined,
      leaseToken: undefined,
    });
    const path = createPacketBundle(root, "packet-1", packet, false).markdownPath;
    expect(await readFile(path, "utf8")).toBe(packet.markdown);
    expect(() => createPacketBundle(root, "packet-1", packet, false)).toThrow();
  });

  test("renders mechanic-validator checklist with mechanical execution ownership", () => {
    const input = base();
    const packet = buildPacket({
      ...input,
      role: "mechanic-validator",
      task: undefined,
      leaseToken: undefined,
    });
    expect(packet.markdown).toContain("# mechanic-validator packet");
    expect(packet.markdown).toContain("100% Mechanical Execution Ownership");
    expect(packet.markdown).toContain("Structured Test Receipts & Evidence Generation");
  });

  test("renders subTask branch packet with non-ui scope", () => {
    const input = base();
    const subToken = "sub-token-xyz";
    const subTask = {
      id: "sub-1",
      label: "Sub Task 1",
      write_scope: ["src/backend.ts"],
      status: "claimed" as const,
      agent_id: "sub-agent-1",
      claimed_at: "2026-08-13T12:05:00.000Z",
      lease: {
        token_digest: tokenDigest(subToken),
        agent_id: "sub-agent-1",
        issued_at: "2026-08-13T12:05:00.000Z",
        expires_at: "2026-08-13T13:00:00.000Z",
        duration_seconds: 60,
      },
    };
    input.state.branches = [
      {
        id: "B-1",
        parent_task_id: "T-1",
        parent_agent_id: "agent",
        reason: "backend work",
        depth: 1,
        status: "open",
        opened_at: "2026-08-13T12:00:00.000Z",
        sub_tasks: [subTask],
      },
    ];

    const packet = buildPacket({
      ...input,
      role: "sub-implementer",
      agentId: "sub-agent-1",
      task: undefined,
      leaseToken: subToken,
      subTask,
    });
    expect(packet.markdown).toContain("# sub-implementer packet");
    expect(packet.markdown).toContain('"write_scope": [\n    "src/backend.ts"\n  ]');
  });

  test("renders subTask branch packet with UI scope", () => {
    const input = base();
    const subToken = "sub-token-ui";
    const subTask = {
      id: "sub-ui-1",
      label: "UI button redesign",
      write_scope: ["src/components/button.tsx"],
      status: "claimed" as const,
      agent_id: "sub-ui-agent",
      claimed_at: "2026-08-13T12:05:00.000Z",
      lease: {
        token_digest: tokenDigest(subToken),
        agent_id: "sub-ui-agent",
        issued_at: "2026-08-13T12:05:00.000Z",
        expires_at: "2026-08-13T13:00:00.000Z",
        duration_seconds: 60,
      },
    };
    input.state.branches = [
      {
        id: "B-2",
        parent_task_id: "T-1",
        parent_agent_id: "agent",
        reason: "ui work",
        depth: 1,
        status: "open",
        opened_at: "2026-08-13T12:00:00.000Z",
        sub_tasks: [subTask],
      },
    ];

    const packet = buildPacket({
      ...input,
      role: "sub-implementer",
      agentId: "sub-ui-agent",
      task: undefined,
      leaseToken: subToken,
      subTask,
    });
    expect(packet.markdown).toContain("# sub-implementer packet");
    expect(packet.markdown).toContain('"write_scope": [\n    "src/components/button.tsx"\n  ]');
  });
});
