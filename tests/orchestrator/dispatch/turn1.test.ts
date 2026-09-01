import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { enforceTurn1OrchestratorInit } from "../../../olt/scripts/src/orchestrator/lifecycle/index.ts";

describe("Orchestrator Turn 1 Init", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];
  let rootCounter = 0;

  function getTurn1Sandbox(name: string): string {
    const dir = `/tmp/virtual-turn1-${++rootCounter}-${name}`;
    mockDirs.add(dir);
    return dir;
  }

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation(
        (p: fs.PathLike) => mockFiles.has(String(p)) || mockDirs.has(String(p)),
      ),
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        const val = mockFiles.get(s);
        if (val !== undefined) return val;
        throw new Error(`ENOENT: no such file, open '${s}'`);
      }) as unknown as typeof fs.readFileSync),
      spyOn(fs, "writeFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        data: string | NodeJS.ArrayBufferView,
      ) => {
        mockFiles.set(
          String(p),
          typeof data === "string"
            ? data
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"),
        );
      }) as unknown as typeof fs.writeFileSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

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
    fs.writeFileSync(join(sandbox, "state.json"), "{ invalid: json content", "utf8");
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
    fs.writeFileSync(join(sandbox, "state.json"), JSON.stringify(["item1", "item2"]), "utf8");
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
    fs.writeFileSync(join(sandbox, "state.json"), JSON.stringify(validState, null, 2), "utf8");
    fs.mkdirSync(join(sandbox, "evidence"), { recursive: true });

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

    fs.writeFileSync(
      join(sandbox, "state.json"),
      JSON.stringify({ run_id: "run-1", tasks: {} }),
      "utf8",
    );
    expect(() => spawnCoordinator(sandbox, "orchestrator")).not.toThrow();
    expect(coordinatorSpawned).toBe(true);
  });
});
