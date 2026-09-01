import { describe, expect, it } from "bun:test";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  IMPASSE_CRUCIBLE_THRESHOLD,
  PARETO_PRIORITY_LEVELS,
  SCALABILITY_THRESHOLD_PERCENT,
  SocraticLadderingEngine,
  type StrategicCommitment,
  type StrategicResolution,
} from "../../../../../olt/scripts/src/mind/auditing/socratic/index.ts";

describe("HistoricalDebateMemory", () => {
  it("records resolutions and indexes commitments correctly", () => {
    const memory = new HistoricalDebateMemory();
    const commitment1: StrategicCommitment = {
      id: "comm-1",
      topic: "State Synchronization",
      agreedResolution: "Use event sourcing invariants",
      targetMilestone: "M1",
      status: "pending",
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
      settledInvariant: "All state mutations must produce durable receipts",
      commitments: [commitment1],
      recordedAt: "2026-09-01T00:00:00.000Z",
    };

    memory.recordResolution(resolution);

    expect(memory.getResolutions().length).toBe(1);
    expect(memory.getCommitments().length).toBe(1);
    expect(memory.getActiveCommitments().length).toBe(1);
    expect(memory.getUnfulfilledCommitments().length).toBe(1);
    expect(memory.getCommitmentById("comm-1")?.agreedResolution).toBe(
      "Use event sourcing invariants",
    );
  });

  it("updates commitment status and handles justifications", () => {
    const memory = new HistoricalDebateMemory();
    const commitment: StrategicCommitment = {
      id: "comm-2",
      topic: "Cache Eviction",
      agreedResolution: "TTL bound to 60s",
      targetMilestone: "M2",
      status: "pending",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    memory.recordCommitment(commitment);

    expect(memory.hasUnfulfilledCommitmentsWithoutJustification()).toBe(true);

    // Update with justification for delay/breach
    memory.updateCommitmentStatus("comm-2", "breached", "Replaced by adaptive cache in cycle 105");

    const updated = memory.getCommitmentById("comm-2");
    expect(updated?.status).toBe("breached");
    expect(updated?.justification).toBe("Replaced by adaptive cache in cycle 105");
    expect(memory.hasUnfulfilledCommitmentsWithoutJustification()).toBe(false);

    // Fulfill commitment
    memory.updateCommitmentStatus("comm-2", "fulfilled");
    expect(memory.getActiveCommitments().length).toBe(0);
    expect(memory.getUnfulfilledCommitments().length).toBe(0);
  });

  it("throws error when updating non-existent commitment", () => {
    const memory = new HistoricalDebateMemory();
    expect(() => {
      memory.updateCommitmentStatus("non-existent", "fulfilled");
    }).toThrow('Commitment with id "non-existent" not found');
  });

  it("retrieves the latest resolution for a topic case-insensitively", () => {
    const memory = new HistoricalDebateMemory();
    memory.recordResolution({
      id: "res-old",
      cycleId: "cycle-1",
      topic: "Storage Engine",
      consensusReached: true,
      winningApproach: "SQLite",
      paretoPriorityLevel: 2,
      settledInvariant: "Single-file storage",
      commitments: [],
      recordedAt: "2026-08-01T00:00:00.000Z",
    });

    memory.recordResolution({
      id: "res-new",
      cycleId: "cycle-2",
      topic: "storage engine",
      consensusReached: true,
      winningApproach: "Embedded LMDB",
      paretoPriorityLevel: 3,
      settledInvariant: "Zero-copy memory map",
      commitments: [],
      recordedAt: "2026-09-01T00:00:00.000Z",
    });

    const latest = memory.getLatestResolutionForTopic("Storage Engine");
    expect(latest?.id).toBe("res-new");
    expect(latest?.winningApproach).toBe("Embedded LMDB");
  });

  it("serializes and deserializes accurately", () => {
    const memory = new HistoricalDebateMemory();
    const commitment: StrategicCommitment = {
      id: "comm-ser",
      topic: "Serialization",
      agreedResolution: "Strict JSON format",
      targetMilestone: "M3",
      status: "pending",
      justification: "Active rollout",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    memory.recordResolution({
      id: "res-ser",
      cycleId: "cycle-ser",
      topic: "Serialization",
      consensusReached: true,
      winningApproach: "Strict JSON",
      paretoPriorityLevel: 2,
      settledInvariant: "Versioned JSON schema",
      commitments: [commitment],
      recordedAt: "2026-09-01T00:00:00.000Z",
    });

    const json = memory.serialize();
    const restored = HistoricalDebateMemory.deserialize(json);

    expect(restored.getResolutions().length).toBe(1);
    expect(restored.getCommitments().length).toBe(1);
    expect(restored.getCommitmentById("comm-ser")?.agreedResolution).toBe("Strict JSON format");
  });

  it("handles malformed JSON or invalid structures safely during deserialization", () => {
    expect(() => HistoricalDebateMemory.deserialize("invalid json")).toThrow();
    expect(() => HistoricalDebateMemory.deserialize("null")).toThrow();
    const empty = HistoricalDebateMemory.deserialize("{}");
    expect(empty.getResolutions().length).toBe(0);
    expect(empty.getCommitments().length).toBe(0);
  });
});
