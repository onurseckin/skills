import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { AgentMetadata } from "../../../olt/scripts/src/runtime/contracts.ts";
import {
  clearInMemoryAgentMetadata,
  deleteInMemoryAgentMetadata,
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
  getAgentMetadataPath,
  getInMemoryAgentMetadata,
  getInMemoryAgentMetadataStore,
  isInMemoryAgentMetadataEnabled,
  replaceAgentMetadataUnlocked,
  serializeValidatedAgentMetadata,
  setInMemoryAgentMetadata,
  withAgentMetadataMutationLock,
  writeAgentMetadata,
  writeAgentMetadataUnlocked,
} from "../../../olt/scripts/src/runtime/session.ts";

function createValidMetadata(agentId = "test-agent", role = "implementer"): AgentMetadata {
  return {
    agent_id: agentId,
    role,
    tier: 3,
    write_scope: ["olt/scripts/src/runtime"],
    allowed_read_scope: ["olt/scripts/src"],
    can_execute_shell: true,
    spawned_at: new Date().toISOString(),
    run_id: "test-run-123",
    task_id: "task-456",
  };
}

describe("Runtime Session In-Memory Agent Metadata Management", () => {
  beforeEach(() => {
    enableInMemoryAgentMetadata();
  });

  afterEach(() => {
    disableInMemoryAgentMetadata();
  });

  it("enables, queries, clears, and disables in-memory agent metadata store", () => {
    expect(isInMemoryAgentMetadataEnabled()).toBe(true);
    const store = getInMemoryAgentMetadataStore();
    expect(store).toBeDefined();

    setInMemoryAgentMetadata("/virtual/path/agent-1.json", '{"agent_id":"agent-1"}');
    expect(getInMemoryAgentMetadata("/virtual/path/agent-1.json")).toBe('{"agent_id":"agent-1"}');

    expect(deleteInMemoryAgentMetadata("/virtual/path/agent-1.json")).toBe(true);
    expect(getInMemoryAgentMetadata("/virtual/path/agent-1.json")).toBeUndefined();
    expect(deleteInMemoryAgentMetadata("/nonexistent")).toBe(false);

    setInMemoryAgentMetadata("/virtual/path/agent-2.json", '{"agent_id":"agent-2"}');
    clearInMemoryAgentMetadata();
    expect(getInMemoryAgentMetadata("/virtual/path/agent-2.json")).toBeUndefined();

    disableInMemoryAgentMetadata();
    expect(isInMemoryAgentMetadataEnabled()).toBe(false);
    expect(getInMemoryAgentMetadataStore()).toBeUndefined();
  });

  it("constructs sanitized agent metadata paths for explicit run roots", () => {
    const p1 = getAgentMetadataPath("worker-alpha", "/custom/run/root");
    expect(p1).toBe("/custom/run/root/runtime/agent-worker-alpha.json");

    const p2 = getAgentMetadataPath("mind-root");
    expect(p2).toContain("runtime/agent-mind-root.json");

    expect(() => getAgentMetadataPath("../unsafe-traversal")).toThrow(HarnessError);
    expect(() => getAgentMetadataPath("")).toThrow(HarnessError);
    expect(() => getAgentMetadataPath("agent/nested")).toThrow(HarnessError);
  });

  it("serializes and validates well-formed agent metadata", () => {
    const meta = createValidMetadata("worker-1", "worker");
    const serialized = serializeValidatedAgentMetadata(meta, "/tmp/agent-worker-1.json");
    expect(serialized).toContain('"agent_id": "worker-1"');
    expect(serialized).toContain('"role": "worker"');
    expect(serialized).toContain('"tier": 3');
  });

  it("fails serialization validation when metadata violates domain schema", () => {
    const invalidMeta = {
      agent_id: "bad-tier",
      role: "worker",
      tier: 99,
      write_scope: [],
      allowed_read_scope: [],
      can_execute_shell: true,
      spawned_at: "2026-08-31T00:00:00.000Z",
    } as unknown as AgentMetadata;

    expect(() => serializeValidatedAgentMetadata(invalidMeta, "/tmp/agent-bad.json")).toThrow(
      HarnessError,
    );
  });

  it("fails serialization when metadata contains cyclic references", () => {
    const cyclicObj: Record<string, unknown> = {};
    cyclicObj.self = cyclicObj;
    const cyclicMeta = {
      agent_id: "cyclic-agent",
      role: "worker",
      tier: 3,
      write_scope: [],
      allowed_read_scope: [],
      can_execute_shell: true,
      spawned_at: "2026-08-31T00:00:00.000Z",
      metadata: cyclicObj,
    } as unknown as AgentMetadata;

    expect(() => serializeValidatedAgentMetadata(cyclicMeta, "/tmp/cyclic.json")).toThrow(
      HarnessError,
    );
  });

  it("persists metadata unlocked in-memory without physical disk writes", () => {
    const meta = createValidMetadata("unlocked-agent", "implementer");
    const filePath = writeAgentMetadataUnlocked(meta, "/virtual/run-root");

    expect(filePath).toBe("/virtual/run-root/runtime/agent-unlocked-agent.json");
    const stored = getInMemoryAgentMetadata(filePath);
    expect(stored).toBeDefined();
    expect(stored).toContain('"agent_id": "unlocked-agent"');
  });

  it("persists metadata with mutation lock in-memory and releases lock properly", () => {
    const meta = createValidMetadata("locked-agent", "implementer");
    const filePath = writeAgentMetadata(meta, "/virtual/run-root");

    expect(filePath).toBe("/virtual/run-root/runtime/agent-locked-agent.json");
    const stored = getInMemoryAgentMetadata(filePath);
    expect(stored).toBeDefined();
    expect(stored).toContain('"agent_id": "locked-agent"');
  });

  it("prevents nested or concurrent lock acquisition on the same virtual root", () => {
    const filePath = "/virtual/run-root/runtime/agent-nested.json";

    const executed = withAgentMetadataMutationLock(filePath, () => {
      expect(() => {
        withAgentMetadataMutationLock(filePath, () => "nested-result");
      }).toThrow(HarnessError);
      return "outer-ok";
    });

    expect(executed).toBe("outer-ok");

    const reacquired = withAgentMetadataMutationLock(filePath, () => "reacquired-ok");
    expect(reacquired).toBe("reacquired-ok");
  });

  it("cleans up virtual lock state when an in-flight operation throws", () => {
    const filePath = "/virtual/run-root/runtime/agent-fault.json";

    expect(() => {
      withAgentMetadataMutationLock(filePath, () => {
        throw new Error("simulated lock operation failure");
      });
    }).toThrow("simulated lock operation failure");

    const subsequent = withAgentMetadataMutationLock(filePath, () => "subsequent-ok");
    expect(subsequent).toBe("subsequent-ok");
  });

  it("replaces agent metadata in-memory directly via replaceAgentMetadataUnlocked", () => {
    const targetPath = "/virtual/run-root/runtime/agent-direct.json";
    const payload = JSON.stringify({ agent_id: "agent-direct", role: "implementer" });

    replaceAgentMetadataUnlocked(targetPath, payload);
    expect(getInMemoryAgentMetadata(targetPath)).toBe(payload);
  });
});
