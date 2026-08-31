import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildPacket } from "../../../olt/scripts/src/packets/render-packet.ts";
import { loadRoleContract } from "../../../olt/scripts/src/packets/role-contract.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";

const commonBytes = new TextEncoder().encode("Preserve unrelated changes. Run focused tests.");
const clock = at("2026-08-13T12:00:00.000Z");

function base() {
  const claim = claimTask(new TestPort(workflowState()), "T-1", "agent", "implementer", { clock });
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
    authoritativeContext: { ...inspectionContext() },
  };
}

describe("role contract binding", () => {
  test("embeds the contract bytes and their digest in every packet", () => {
    const contract = loadRoleContract("implementer");
    const packet = buildPacket({ ...base(), role: "implementer" });
    expect(packet.metadata.role_contract_sha256).toBe(contract.sha256);
    expect(packet.metadata.role).toBe("implementer");
    expect(packet.markdown).toContain("# implementer packet");
  });

  test("the embedded digest covers the bytes an agent actually reads", () => {
    const contract = loadRoleContract("implementer");
    const packet = buildPacket({ ...base(), role: "implementer" });
    expect(packet.metadata.role_contract_sha256).toBe(
      createHash("sha256").update(contract.bytes).digest("hex"),
    );
  });

  test("resolves the contract from the packet role when none is injected", () => {
    const input = base();
    input.task!.original_implementer = "author-agent";
    input.agentId = "author-agent";
    input.task!.lease!.agent_id = "author-agent";
    input.task!.lease!.role = "repairer";
    const packet = buildPacket({ ...input, role: "repairer", agentId: "author-agent" });
    expect(packet.metadata.role_contract_sha256).toBe(loadRoleContract("repairer").sha256);
  });

  test("refuses a contract that does not match the packet role", () => {
    expect(() =>
      buildPacket({ ...base(), role: "implementer", roleContract: loadRoleContract("validator") }),
    ).toThrow(/role contract does not match/u);
  });
});
