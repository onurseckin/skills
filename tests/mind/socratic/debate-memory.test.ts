import { describe, expect, it } from "bun:test";
import {
  COMMITMENT_STATUSES,
  HistoricalDebateMemory,
  PARETO_PRIORITY_LEVELS,
  type StrategicCommitment,
  type StrategicResolution,
} from "../../../olt/scripts/src/mind/auditing/socratic/index.ts";

describe("HistoricalDebateMemory", () => {
  it("records resolutions and automatically indexes nested commitments", () => {
    const memory = new HistoricalDebateMemory();
    const comm1: StrategicCommitment = {
      id: "comm-1",
      topic: "State Synchronization",
      agreedResolution: "Use event sourcing receipts",
      targetMilestone: "M1",
      status: COMMITMENT_STATUSES.PENDING,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };

    const resolution: StrategicResolution = {
      id: "res-1",
      cycleId: "cycle-100",
      topic: "State Synchronization",
      consensusReached: true,
      winningApproach: "Event Sourcing Architecture",
      paretoPriorityLevel: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
      settledInvariant: "All state mutations produce durable receipts",
      commitments: [comm1],
      recordedAt: "2026-09-01T00:00:00.000Z",
    };

    memory.recordResolution(resolution);

    expect(memory.getResolutions()).toHaveLength(1);
    expect(memory.getCommitments()).toHaveLength(1);
    expect(memory.getActiveCommitments()).toHaveLength(1);
    expect(memory.getUnfulfilledCommitments()).toHaveLength(1);
    expect(memory.getCommitmentById("comm-1")?.agreedResolution).toBe(
      "Use event sourcing receipts",
    );
  });

  it("retrieves active and unfulfilled commitments accurately across status transitions", () => {
    const memory = new HistoricalDebateMemory();

    const pendingComm: StrategicCommitment = {
      id: "comm-pend",
      topic: "Storage",
      agreedResolution: "WAL journaling",
      targetMilestone: "M1",
      status: "pending",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const breachedComm: StrategicCommitment = {
      id: "comm-breach",
      topic: "Cache",
      agreedResolution: "TTL bound",
      targetMilestone: "M1",
      status: "breached",
      justification: "Replaced by LRU in cycle 12",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const fulfilledComm: StrategicCommitment = {
      id: "comm-done",
      topic: "Auth",
      agreedResolution: "Zero token leak",
      targetMilestone: "M1",
      status: "fulfilled",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const supersededComm: StrategicCommitment = {
      id: "comm-super",
      topic: "Network",
      agreedResolution: "HTTP/1.1 fallback",
      targetMilestone: "M1",
      status: "superseded",
      justification: "HTTP/2 mandatory everywhere",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };

    memory.recordCommitment(pendingComm);
    memory.recordCommitment(breachedComm);
    memory.recordCommitment(fulfilledComm);
    memory.recordCommitment(supersededComm);

    // Active commitments: pending only
    const active = memory.getActiveCommitments();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe("comm-pend");

    // Unfulfilled commitments: pending and breached
    const unfulfilled = memory.getUnfulfilledCommitments();
    expect(unfulfilled).toHaveLength(2);
    expect(unfulfilled.map((c) => c.id).sort()).toEqual(["comm-breach", "comm-pend"]);
  });

  it("handles commitment status transitions (pending -> fulfilled, breached, superseded) with audit justifications", () => {
    const memory = new HistoricalDebateMemory();
    const comm: StrategicCommitment = {
      id: "comm-transition",
      topic: "Telemetry Buffer",
      agreedResolution: "Zero-drop ring buffer",
      targetMilestone: "M1",
      status: "pending",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    memory.recordCommitment(comm);

    // 1. Transition to breached with justification
    memory.updateCommitmentStatus(
      "comm-transition",
      "breached",
      "Memory pressure required dropping non-critical spans",
    );
    const breached = memory.getCommitmentById("comm-transition");
    expect(breached?.status).toBe("breached");
    expect(breached?.justification).toBe("Memory pressure required dropping non-critical spans");

    // 2. Transition to superseded with justification
    memory.updateCommitmentStatus(
      "comm-transition",
      "superseded",
      "Replaced by kernel-backed eBPF ring buffer",
    );
    const superseded = memory.getCommitmentById("comm-transition");
    expect(superseded?.status).toBe("superseded");
    expect(superseded?.justification).toBe("Replaced by kernel-backed eBPF ring buffer");

    // 3. Transition to fulfilled
    memory.updateCommitmentStatus("comm-transition", "fulfilled");
    const fulfilled = memory.getCommitmentById("comm-transition");
    expect(fulfilled?.status).toBe("fulfilled");
    expect(memory.getActiveCommitments()).toHaveLength(0);
    expect(memory.getUnfulfilledCommitments()).toHaveLength(0);
  });

  it("evaluates hasUnfulfilledCommitmentsWithoutJustification correctly", () => {
    const memory = new HistoricalDebateMemory();
    expect(memory.hasUnfulfilledCommitmentsWithoutJustification()).toBe(false);

    // Add unfulfilled commitment without justification
    memory.recordCommitment({
      id: "comm-no-just",
      topic: "Security Sandbox",
      agreedResolution: "Seccomp filter",
      targetMilestone: "M1",
      status: "pending",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(memory.hasUnfulfilledCommitmentsWithoutJustification()).toBe(true);

    // Add justification
    memory.updateCommitmentStatus("comm-no-just", "pending", "Blocked on Linux 6.6 kernel upgrade");
    expect(memory.hasUnfulfilledCommitmentsWithoutJustification()).toBe(false);

    // Breached without justification
    memory.recordCommitment({
      id: "comm-breached-raw",
      topic: "DB Migration",
      agreedResolution: "Zero downtime schema change",
      targetMilestone: "M1",
      status: "breached",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(memory.hasUnfulfilledCommitmentsWithoutJustification()).toBe(true);

    // Fulfill breached commitment
    memory.updateCommitmentStatus("comm-breached-raw", "fulfilled");
    expect(memory.hasUnfulfilledCommitmentsWithoutJustification()).toBe(false);
  });

  it("retrieves topic resolutions case-insensitively, returning the latest entry", () => {
    const memory = new HistoricalDebateMemory();

    memory.recordResolution({
      id: "res-old",
      cycleId: "cycle-1",
      topic: "Storage Architecture",
      consensusReached: true,
      winningApproach: "RocksDB",
      paretoPriorityLevel: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
      settledInvariant: "LSM tree on local disk",
      commitments: [],
      recordedAt: "2026-08-01T00:00:00.000Z",
    });

    memory.recordResolution({
      id: "res-latest",
      cycleId: "cycle-2",
      topic: "storage architecture",
      consensusReached: true,
      winningApproach: "Embedded LMDB",
      paretoPriorityLevel: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
      settledInvariant: "Zero-copy mmap",
      commitments: [],
      recordedAt: "2026-09-01T00:00:00.000Z",
    });

    const result = memory.getLatestResolutionForTopic("STORAGE ARCHITECTURE");
    expect(result).toBeDefined();
    expect(result?.id).toBe("res-latest");
    expect(result?.winningApproach).toBe("Embedded LMDB");

    const nonExistent = memory.getLatestResolutionForTopic("Unrelated Topic");
    expect(nonExistent).toBeUndefined();
  });

  it("serializes and performs lossless deserialization of debate memory", () => {
    const memory = new HistoricalDebateMemory();
    const comm: StrategicCommitment = {
      id: "comm-ser",
      topic: "IPC Protocol",
      agreedResolution: "Mailbox IPC exclusively",
      targetMilestone: "M2",
      status: "pending",
      justification: "Migration in progress",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };

    memory.recordResolution({
      id: "res-ser",
      cycleId: "cycle-ser-1",
      topic: "IPC Protocol",
      consensusReached: true,
      winningApproach: "Mailbox IPC",
      paretoPriorityLevel: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
      settledInvariant: "Strict zero-token native messaging",
      commitments: [comm],
      recordedAt: "2026-09-01T00:00:00.000Z",
    });

    const json = memory.serialize();
    const restored = HistoricalDebateMemory.deserialize(json);

    expect(restored.getResolutions()).toHaveLength(1);
    expect(restored.getCommitments()).toHaveLength(1);
    expect(restored.getCommitmentById("comm-ser")?.agreedResolution).toBe(
      "Mailbox IPC exclusively",
    );
    expect(restored.getLatestResolutionForTopic("ipc protocol")?.winningApproach).toBe(
      "Mailbox IPC",
    );
  });

  it("handles errors gracefully during commitment status update and deserialization", () => {
    const memory = new HistoricalDebateMemory();
    expect(() => {
      memory.updateCommitmentStatus("missing-id", "fulfilled");
    }).toThrow('Commitment with id "missing-id" not found');

    expect(() => HistoricalDebateMemory.deserialize("invalid json")).toThrow();
    expect(() => HistoricalDebateMemory.deserialize("null")).toThrow();

    const empty = HistoricalDebateMemory.deserialize("{}");
    expect(empty.getResolutions()).toHaveLength(0);
    expect(empty.getCommitments()).toHaveLength(0);
  });
});
