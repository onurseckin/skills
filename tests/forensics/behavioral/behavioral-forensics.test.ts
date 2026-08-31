/**
 * @file forensics.test.ts
 * Unit tests for Behavioral Forensics Heuristics, Token Burn, and System Leaks.
 */

import { describe, expect, it } from "bun:test";
import {
  analyzeBehavioralForensics,
  type ExtractedToolCall,
} from "../../../olt/scripts/src/heuristics/index.ts";

describe("Behavioral Forensics: 7 Core Heuristics Suites", () => {
  it("detects TOKEN_BURNING from excessive reads before first write and high exploration ratio", () => {
    const toolCalls: ExtractedToolCall[] = [
      { agentId: "impl-1", name: "view_file", isRead: true, isWrite: false, isPoll: false },
      { agentId: "impl-1", name: "view_file", isRead: true, isWrite: false, isPoll: false },
      { agentId: "impl-1", name: "list_dir", isRead: true, isWrite: false, isPoll: false },
      { agentId: "impl-1", name: "grep_search", isRead: true, isWrite: false, isPoll: false },
      { agentId: "impl-1", name: "find_by_name", isRead: true, isWrite: false, isPoll: false },
      { agentId: "impl-1", name: "view_file", isRead: true, isWrite: false, isPoll: false },
      {
        agentId: "impl-1",
        name: "replace_file_content",
        isRead: false,
        isWrite: true,
        isPoll: false,
      },
    ];

    const result = analyzeBehavioralForensics({
      runId: "run-token-burn-01",
      allToolCalls: toolCalls,
    });

    expect(result.isClean).toBe(false);
    expect(result.incidents.some((i) => i.category === "TOKEN_BURNING")).toBe(true);
    const inc = result.incidents.find((i) => i.category === "TOKEN_BURNING");
    expect(inc?.agentId).toBe("impl-1");
    expect(inc?.severity).toBe("HIGH");
  });

  it("detects FALSE_SERIALIZATION when disjoint write scopes are executed in sequence", () => {
    const result = analyzeBehavioralForensics({
      runId: "run-false-serialization",
      tasks: [
        {
          id: "task-auth",
          status: "done",
          writeScope: ["src/auth.ts"],
          dependencies: [],
          startedAt: 1000,
          completedAt: 1500,
        },
        {
          id: "task-billing",
          status: "done",
          writeScope: ["src/billing.ts"],
          dependencies: [],
          startedAt: 1600,
          completedAt: 2000,
        },
        {
          id: "task-users",
          status: "done",
          writeScope: ["src/users.ts"],
          dependencies: [],
          startedAt: 2100,
          completedAt: 2500,
        },
      ],
    });

    expect(result.isClean).toBe(false);
    expect(result.incidents.some((i) => i.category === "FALSE_SERIALIZATION")).toBe(true);
    const inc = result.incidents.find((i) => i.category === "FALSE_SERIALIZATION");
    expect(inc?.severity).toBe("HIGH");
  });

  it("detects ROLE_BOUNDARY_DEVIATION when supervisor executes direct code modification", () => {
    const toolCalls: ExtractedToolCall[] = [
      {
        agentId: "coord-1",
        name: "write_to_file",
        isRead: false,
        isWrite: true,
        isPoll: false,
      },
    ];

    const result = analyzeBehavioralForensics({
      runId: "run-role-deviation",
      allToolCalls: toolCalls,
      agents: [{ id: "coord-1", role: "coordinator" }],
    });

    expect(result.isClean).toBe(false);
    expect(result.incidents.some((i) => i.category === "ROLE_BOUNDARY_DEVIATION")).toBe(true);
    const inc = result.incidents.find((i) => i.category === "ROLE_BOUNDARY_DEVIATION");
    expect(inc?.severity).toBe("CRITICAL");
  });

  it("detects ROLE_BOUNDARY_DEVIATION when validator executes write tool", () => {
    const toolCalls: ExtractedToolCall[] = [
      {
        agentId: "val-1",
        name: "write_to_file",
        isRead: false,
        isWrite: true,
        isPoll: false,
      },
    ];

    const result = analyzeBehavioralForensics({
      runId: "run-val-deviation",
      allToolCalls: toolCalls,
      agents: [{ id: "val-1", role: "validator" }],
    });

    expect(result.isClean).toBe(false);
    expect(result.incidents.some((i) => i.category === "ROLE_BOUNDARY_DEVIATION")).toBe(true);
    const inc = result.incidents.find((i) => i.category === "ROLE_BOUNDARY_DEVIATION");
    expect(inc?.severity).toBe("HIGH");
  });

  it("detects POLLING_WASTE when an agent makes >= 5 polling calls", () => {
    const toolCalls: ExtractedToolCall[] = [
      { agentId: "impl-poll", name: "manage_task", isRead: false, isWrite: false, isPoll: true },
      { agentId: "impl-poll", name: "manage_task", isRead: false, isWrite: false, isPoll: true },
      { agentId: "impl-poll", name: "schedule", isRead: false, isWrite: false, isPoll: true },
      { agentId: "impl-poll", name: "manage_task", isRead: false, isWrite: false, isPoll: true },
      { agentId: "impl-poll", name: "manage_task", isRead: false, isWrite: false, isPoll: true },
      { agentId: "impl-poll", name: "manage_task", isRead: false, isWrite: false, isPoll: true },
      { agentId: "impl-poll", name: "manage_task", isRead: false, isWrite: false, isPoll: true },
    ];

    const result = analyzeBehavioralForensics({
      runId: "run-polling-waste",
      allToolCalls: toolCalls,
    });

    expect(result.isClean).toBe(false);
    expect(result.metrics.pollingCallsCount).toBe(7);
    expect(result.incidents.some((i) => i.category === "POLLING_WASTE")).toBe(true);
  });

  it("detects CONTEXT_OVERFLOW when agent exceeds token budget or prompt bloat", () => {
    const result = analyzeBehavioralForensics({
      runId: "run-context-overflow",
      agents: [
        {
          id: "heavy-agent-1",
          role: "implementer",
          tokensIn: 130000,
          tokensOut: 25000,
          totalTokens: 155000,
        },
      ],
    });

    expect(result.isClean).toBe(false);
    expect(result.incidents.some((i) => i.category === "CONTEXT_OVERFLOW")).toBe(true);
  });

  it("detects GHOST_LEASE when task remains leased to a released agent", () => {
    const result = analyzeBehavioralForensics({
      runId: "run-ghost-lease",
      agents: [{ id: "agent-zombie", status: "released" }],
      tasks: [
        {
          id: "task-orphaned",
          status: "leased",
          writeScope: ["src/orphaned.ts"],
          dependencies: [],
          lease: { agentId: "agent-zombie" },
        },
      ],
    });

    expect(result.isClean).toBe(false);
    expect(result.metrics.ghostLeasesCount).toBe(1);
    expect(result.incidents.some((i) => i.category === "GHOST_LEASE")).toBe(true);
  });

  it("detects STRAGGLER when task execution duration disproportionately exceeds cohort average", () => {
    const result = analyzeBehavioralForensics({
      runId: "run-straggler",
      tasks: [
        { id: "task-fast-1", status: "done", writeScope: [], dependencies: [], durationSec: 10 },
        { id: "task-fast-2", status: "done", writeScope: [], dependencies: [], durationSec: 15 },
        { id: "task-slow", status: "done", writeScope: [], dependencies: [], durationSec: 350 },
      ],
    });

    expect(result.isClean).toBe(false);
    expect(result.metrics.stragglerTasksCount).toBe(1);
    expect(result.incidents.some((i) => i.category === "STRAGGLER")).toBe(true);
  });
});
