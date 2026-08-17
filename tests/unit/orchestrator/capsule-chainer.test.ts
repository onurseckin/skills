import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chainCapsules } from "../../../orchestrating-long-tasks/scripts/src/orchestrator/capsule-chainer.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import type { CapsuleChainManifest } from "../../../orchestrating-long-tasks/scripts/src/orchestrator/types.ts";

describe("Capsule Chainer Unit Tests", () => {
  it("chains capsule state, carryover requirements, and unresolved findings", () => {
    const testDir = mkdtempSync(join(tmpdir(), "capsule-chain-test-"));
    try {
      const sourceCapsule = join(testDir, "run-1");
      const targetCapsule = join(testDir, "run-2");
      mkdirSync(sourceCapsule, { recursive: true });

      // Write mock source manifest
      writeFileSync(
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

      // Write mock source state
      writeFileSync(
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

      // Verify file written to target
      const targetManifestFile = join(targetCapsule, "chain_manifest.json");
      const readContent = JSON.parse(
        readFileSync(targetManifestFile, "utf-8"),
      ) as CapsuleChainManifest;
      expect(readContent.targetRunId).toBe("run-2");
      expect(readContent.carryoverRequirements).toEqual(["req-02"]);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("throws HarnessError INVALID_ARGUMENT when source capsule does not exist", () => {
    const nonExistent = join(tmpdir(), "non-existent-source-capsule-12345");
    expect(() => {
      chainCapsules({
        sourceRunId: "run-x",
        targetRunId: "run-y",
        sourceCapsulePath: nonExistent,
        targetCapsulePath: join(tmpdir(), "target"),
        roundNumber: 2,
      });
    }).toThrow(HarnessError);
  });

  it("throws HarnessError INTEGRITY when source manifest is corrupt", () => {
    const testDir = mkdtempSync(join(tmpdir(), "capsule-corrupt-test-"));
    try {
      const sourceCapsule = join(testDir, "run-corrupt");
      mkdirSync(sourceCapsule, { recursive: true });
      writeFileSync(join(sourceCapsule, "manifest.json"), "{ invalid json");

      expect(() => {
        chainCapsules({
          sourceRunId: "run-corrupt",
          targetRunId: "run-target",
          sourceCapsulePath: sourceCapsule,
          targetCapsulePath: join(testDir, "target"),
          roundNumber: 2,
        });
      }).toThrow(HarnessError);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
