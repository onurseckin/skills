import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { chainCapsules } from "../../../olt/scripts/src/orchestrator/capsule-chainer.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { CapsuleChainManifest } from "../../../olt/scripts/src/orchestrator/types.ts";

describe("Capsule Chainer Unit Tests", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];
  let rootCounter = 0;

  function getTestDir(name: string): string {
    const dir = `/tmp/virtual-chain-${++rootCounter}-${name}`;
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

  it("chains capsule state, carryover requirements, and unresolved findings", () => {
    const testDir = getTestDir("chain-forward");
    const sourceCapsule = join(testDir, "run-1");
    const targetCapsule = join(testDir, "run-2");
    fs.mkdirSync(sourceCapsule, { recursive: true });

    fs.writeFileSync(
      join(sourceCapsule, "manifest.json"),
      JSON.stringify({
        schema: "harness.manifest",
        version: 1,
        run_id: "run-1",
        capsule_id: "cap-1",
        prompt_sha256: "abc123hash",
        prompt_bytes: 100,
        capture_mode: "stdin",
        source_verified: true,
        assurance: "source-verified",
        bun_version: "1.3.14",
        runtime_version: "0.1.0",
      }),
    );

    fs.writeFileSync(
      join(sourceCapsule, "state.json"),
      JSON.stringify({
        schema: "harness.state",
        version: 1,
        revision: 4,
        event_sequence: 10,
        event_head: "sha256-event-10",
        requirements: [
          { id: "req-01", status: "satisfied" },
          { id: "req-02", status: "planned" },
        ],
        tasks: {
          "task-01": {
            id: "task-01",
            status: "done",
            findings: [
              { id: "f-01", status: "resolved" },
              { id: "f-02", status: "open" },
            ],
          },
        },
      }),
    );

    const chainManifest = chainCapsules({
      sourceRunId: "run-1",
      targetRunId: "run-2",
      sourceCapsulePath: sourceCapsule,
      targetCapsulePath: targetCapsule,
      roundNumber: 2,
    });

    expect(chainManifest.schema).toBe("orchestrator.chain_manifest");
    expect(chainManifest.version).toBe(1);
    expect(chainManifest.sourceRunId).toBe("run-1");
    expect(chainManifest.targetRunId).toBe("run-2");
    expect(chainManifest.roundNumber).toBe(2);
    expect(chainManifest.previousEventHead).toBe("sha256-event-10");
    expect(chainManifest.carryoverRequirements).toEqual(["req-02"]);
    expect(chainManifest.unresolvedFindingIds).toEqual(["f-02"]);

    const targetManifestFile = join(targetCapsule, "chain_manifest.json");
    const readContent = JSON.parse(
      fs.readFileSync(targetManifestFile, "utf-8"),
    ) as CapsuleChainManifest;
    expect(readContent.targetRunId).toBe("run-2");
    expect(readContent.carryoverRequirements).toEqual(["req-02"]);
  });

  it("throws HarnessError INVALID_ARGUMENT when source capsule does not exist", () => {
    const testDir = getTestDir("no-source");
    const nonExistent = join(testDir, "non-existent-source-capsule");
    expect(() => {
      chainCapsules({
        sourceRunId: "run-x",
        targetRunId: "run-y",
        sourceCapsulePath: nonExistent,
        targetCapsulePath: join(testDir, "target"),
        roundNumber: 2,
      });
    }).toThrow(HarnessError);
  });

  it("throws HarnessError INTEGRITY when source manifest is corrupt", () => {
    const testDir = getTestDir("corrupt-manifest");
    const sourceCapsule = join(testDir, "run-corrupt");
    fs.mkdirSync(sourceCapsule, { recursive: true });
    fs.writeFileSync(join(sourceCapsule, "manifest.json"), "{ invalid json");

    expect(() => {
      chainCapsules({
        sourceRunId: "run-corrupt",
        targetRunId: "run-target",
        sourceCapsulePath: sourceCapsule,
        targetCapsulePath: join(testDir, "target"),
        roundNumber: 2,
      });
    }).toThrow(HarnessError);
  });

  it("folds defect-synthesis findings into carryover, deduping against state and each other", () => {
    const testDir = getTestDir("defect-synthesis-carryover");
    const sourceCapsule = join(testDir, "run-1");
    const targetCapsule = join(testDir, "run-2");
    fs.mkdirSync(sourceCapsule, { recursive: true });

    fs.writeFileSync(
      join(sourceCapsule, "state.json"),
      JSON.stringify({
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: "sha256-event-1",
        requirements: [{ id: "req-01", status: "planned" }],
        tasks: {
          "task-01": {
            id: "task-01",
            status: "changes_requested",
            findings: [{ id: "f-already-open", status: "open" }],
          },
        },
      }),
    );

    const chainManifest = chainCapsules({
      sourceRunId: "run-1",
      targetRunId: "run-2",
      sourceCapsulePath: sourceCapsule,
      targetCapsulePath: targetCapsule,
      roundNumber: 2,
      defectSynthesis: {
        roundNumber: 2,
        priorRunId: "run-1",
        originalPrompt: "build the thing",
        gateFailures: ["G-1"],
        synthesizedPrompt: "fix the thing",
        affectedFiles: ["src/thing.ts"],
        unresolvedFindings: [
          {
            id: "f-already-open",
            requirement_id: "req-01",
            severity: "important",
            file_paths: ["src/thing.ts"],
            observation: "already tracked from state.json",
            remediation: "n/a",
          },
          {
            id: "f-new-from-critic",
            requirement_id: "req-02",
            severity: "critical",
            file_paths: ["src/other.ts"],
            observation: "critic found a new defect this round",
            remediation: "fix it",
          },
        ],
      },
    });

    expect(chainManifest.unresolvedFindingIds).toEqual(["f-already-open", "f-new-from-critic"]);
    expect(chainManifest.carryoverRequirements).toEqual(["req-01", "req-02"]);
  });

  it("refuses an unreadable source state instead of chaining an empty carryover", () => {
    const testDir = getTestDir("bad-state");
    const sourceCapsule = join(testDir, "run-bad-state");
    fs.mkdirSync(sourceCapsule, { recursive: true });
    fs.writeFileSync(join(sourceCapsule, "state.json"), "{ not json at all");

    expect(() => {
      chainCapsules({
        sourceRunId: "run-bad-state",
        targetRunId: "run-target",
        sourceCapsulePath: sourceCapsule,
        targetCapsulePath: join(testDir, "target"),
        roundNumber: 2,
      });
    }).toThrow("Corrupt source state");
  });
});
