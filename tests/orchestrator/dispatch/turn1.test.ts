import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { enforceTurn1OrchestratorInit } from "../../../olt/scripts/src/orchestrator/lifecycle/index.ts";

function getTurn1Sandbox(name: string): string {
  const dir = join(tmpdir(), `orchestrator-turn1-${Date.now()}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Orchestrator Turn 1 Init", () => {
  test("throws INVALID_ARGUMENT when runRoot is empty or whitespace", () => {
    expect(() => enforceTurn1OrchestratorInit("", "orchestrator")).toThrow(HarnessError);
    try {
      enforceTurn1OrchestratorInit("   ", "orchestrator");
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
    }
  });

  test("throws INVALID_ARGUMENT when orchId is empty or whitespace", () => {
    const sandbox = getTurn1Sandbox("empty-orch-id");
    expect(() => enforceTurn1OrchestratorInit(sandbox, "")).toThrow(HarnessError);
    try {
      enforceTurn1OrchestratorInit(sandbox, "  ");
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
    }
  });

  test("throws ROLE_CONFINEMENT_VIOLATION when non-orchestrator attempts turn 1 init", () => {
    const sandbox = getTurn1Sandbox("role-violation");
    const unauthorizedRoles = [
      "implementer_task-1",
      "validator_code-quality",
      "worker",
      "critic",
      "repairer",
    ];

    for (const actorId of unauthorizedRoles) {
      expect(() => enforceTurn1OrchestratorInit(sandbox, actorId)).toThrow(HarnessError);
      try {
        enforceTurn1OrchestratorInit(sandbox, actorId);
      } catch (err) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
      }
    }
  });

  test("throws INVALID_STATE when runRoot directory does not exist", () => {
    const nonExistentPath = join(getTurn1Sandbox("missing-dir"), "does-not-exist-dir");
    expect(() => enforceTurn1OrchestratorInit(nonExistentPath, "orchestrator")).toThrow(
      HarnessError,
    );
    try {
      enforceTurn1OrchestratorInit(nonExistentPath, "orchestrator");
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INVALID_STATE");
    }
  });

  test("throws INVALID_STATE when state.json is missing in capsule directory", () => {
    const sandbox = getTurn1Sandbox("missing-state-json");
    expect(() => enforceTurn1OrchestratorInit(sandbox, "orchestrator_run-1")).toThrow(HarnessError);
    try {
      enforceTurn1OrchestratorInit(sandbox, "orchestrator_run-1");
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INVALID_STATE");
    }
  });

  test("throws INTEGRITY when state.json is malformed or invalid JSON", () => {
    const sandbox = getTurn1Sandbox("corrupted-state-json");
    writeFileSync(join(sandbox, "state.json"), "{ invalid: json content", "utf8");
    expect(() => enforceTurn1OrchestratorInit(sandbox, "orchestrator")).toThrow(HarnessError);
    try {
      enforceTurn1OrchestratorInit(sandbox, "orchestrator");
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INTEGRITY");
    }
  });

  test("throws INTEGRITY when state.json root is not an object", () => {
    const sandbox = getTurn1Sandbox("array-state-json");
    writeFileSync(join(sandbox, "state.json"), JSON.stringify(["item1", "item2"]), "utf8");
    expect(() => enforceTurn1OrchestratorInit(sandbox, "orchestrator")).toThrow(HarnessError);
    try {
      enforceTurn1OrchestratorInit(sandbox, "orchestrator");
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INTEGRITY");
    }
  });

  test("passes verification cleanly when capsule directory contains valid state.json", () => {
    const sandbox = getTurn1Sandbox("valid-capsule-init");
    const validState = {
      run_id: "run-turn1-test",
      created_at: new Date().toISOString(),
      tasks: {},
      graph: { nodes: [] },
    };
    writeFileSync(join(sandbox, "state.json"), JSON.stringify(validState, null, 2), "utf8");
    mkdirSync(join(sandbox, "evidence"), { recursive: true });

    expect(() => enforceTurn1OrchestratorInit(sandbox, "orchestrator")).not.toThrow();
    expect(() => enforceTurn1OrchestratorInit(sandbox, "orchestrator_wave-1")).not.toThrow();
    expect(() => enforceTurn1OrchestratorInit(sandbox, "mind")).not.toThrow();
  });

  test("blocks downstream coordinator spawning when Turn 1 initialization is omitted", () => {
    const sandbox = getTurn1Sandbox("block-coordinator-spawn");
    let coordinatorSpawned = false;

    const spawnCoordinator = (runDir: string, orch: string) => {
      enforceTurn1OrchestratorInit(runDir, orch);
      coordinatorSpawned = true;
    };

    expect(() => spawnCoordinator(sandbox, "orchestrator")).toThrow(HarnessError);
    expect(coordinatorSpawned).toBe(false);

    writeFileSync(
      join(sandbox, "state.json"),
      JSON.stringify({ run_id: "run-1", tasks: {} }),
      "utf8",
    );
    expect(() => spawnCoordinator(sandbox, "orchestrator")).not.toThrow();
    expect(coordinatorSpawned).toBe(true);
  });
});
