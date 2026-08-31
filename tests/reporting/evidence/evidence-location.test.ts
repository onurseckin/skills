import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyUnifiedEvidenceLocation } from "../../../olt/scripts/src/reporting/doctor/evidence-location.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { UNIFIED_EVIDENCE_DIRECTORY } from "../../../olt/scripts/src/validation/reporters/index.ts";

const SCRATCH_DIR = resolve(join(process.cwd(), "coverage", "scratch", "evidence-location-tests"));

export const evidenceLocationSuiteName = "doctor/evidence-location";

describe(evidenceLocationSuiteName, () => {
  beforeEach(() => {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
    mkdirSync(SCRATCH_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
  });

  it("returns valid result when no captures, state, or evidence directory exist", () => {
    const emptyRunRoot = join(SCRATCH_DIR, "empty-run");
    const result = verifyUnifiedEvidenceLocation(emptyRunRoot, null);

    expect(result.valid).toBe(true);
    expect(result.checkedCount).toBe(0);
    expect(result.invalidCount).toBe(0);
    expect(result.invalidPaths).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("audits captures ledger with valid unified paths and flags non-unified paths", () => {
    const runRoot = join(SCRATCH_DIR, "captures-run");
    mkdirSync(runRoot, { recursive: true });

    // Write a captures.jsonl ledger
    const capturesFile = join(runRoot, "captures.json");
    const ledger = {
      schema: "harness.captures",
      version: 1,
      captures: [
        {
          kind: "screenshot",
          name: "valid-screenshot",
          sha256: "a".repeat(64),
          bytes: 100,
          blob_path: "blobs/1",
          path: "evidence/screenshots/valid.png",
          storage: "file",
          original_path: "/orig/1",
        },
        {
          kind: "screenshot",
          name: "invalid-screenshot",
          sha256: "b".repeat(64),
          bytes: 100,
          blob_path: "blobs/2",
          path: "/var/tmp/non-unified.png",
          storage: "file",
          original_path: "/orig/2",
        },
      ],
      updated_at: "2026-08-24T00:00:00.000Z",
    };
    writeFileSync(capturesFile, JSON.stringify(ledger, null, 2), "utf-8");

    const result = verifyUnifiedEvidenceLocation(runRoot, null);
    expect(result.valid).toBe(false);
    expect(result.checkedCount).toBe(2);
    expect(result.invalidCount).toBe(1);
    expect(result.invalidPaths).toContain("/var/tmp/non-unified.png");
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]).toContain('Capture record "invalid-screenshot"');
  });

  it("audits task validation findings in state and flags invalid paths", () => {
    const runRoot = join(SCRATCH_DIR, "state-task-run");
    mkdirSync(runRoot, { recursive: true });

    const state: JsonObject = {
      tasks: {
        "task-1": {
          id: "task-1",
          validations: [
            {
              findings: [
                {
                  id: "f-1",
                  evidence: [
                    { path: "evidence/screenshots/screen1.png" },
                    { path: join(runRoot, "evidence", "proof.txt") },
                    { path: "/outside/unauthorized.png" },
                  ],
                },
                null, // Non-object finding
                "invalid-finding", // Non-object
              ],
            },
            null, // Non-object validation
          ],
        },
        "task-invalid": "not-an-object",
      },
    };

    const result = verifyUnifiedEvidenceLocation(runRoot, state);
    expect(result.valid).toBe(false);
    expect(result.checkedCount).toBe(3);
    expect(result.invalidCount).toBe(1);
    expect(result.invalidPaths).toEqual(["/outside/unauthorized.png"]);
    expect(result.issues[0]).toContain('Task "task-1" validation finding evidence path');
  });

  it("audits packet evidence in state and flags invalid paths", () => {
    const runRoot = join(SCRATCH_DIR, "state-packet-run");
    mkdirSync(runRoot, { recursive: true });

    const state: JsonObject = {
      packets: {
        "packet-1": {
          id: "packet-1",
          evidence: {
            evidence: [
              { path: "evidence/packet-valid.json" },
              { path: "/tmp/invalid-packet.json" },
              { path: 123 }, // Non-string path ignored
              null, // Non-object ignored
            ],
          },
        },
        "packet-no-evidence": {
          id: "packet-no-evidence",
          evidence: null,
        },
        "packet-invalid": "not-an-object",
      },
    };

    const result = verifyUnifiedEvidenceLocation(runRoot, state);
    expect(result.valid).toBe(false);
    expect(result.checkedCount).toBe(2);
    expect(result.invalidCount).toBe(1);
    expect(result.invalidPaths).toEqual(["/tmp/invalid-packet.json"]);
    expect(result.issues[0]).toContain('Packet "packet-1" evidence path');
  });

  it("audits physical evidence directory entries", () => {
    const runRoot = join(SCRATCH_DIR, "physical-evidence-run");
    const evidenceDir = join(runRoot, UNIFIED_EVIDENCE_DIRECTORY);
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, "file1.txt"), "evidence 1");
    writeFileSync(join(evidenceDir, "file2.txt"), "evidence 2");

    const result = verifyUnifiedEvidenceLocation(runRoot, null);
    expect(result.valid).toBe(true);
    expect(result.checkedCount).toBe(2);
    expect(result.invalidCount).toBe(0);
  });
});
