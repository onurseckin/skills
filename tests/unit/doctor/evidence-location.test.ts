import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyUnifiedEvidenceLocation } from "../../../orchestrating-long-tasks/scripts/src/doctor/evidence-location.ts";
import {
  isUnifiedEvidencePath,
  isUnifiedEvidenceRelativePath,
  formatUnifiedEvidencePath,
} from "../../../orchestrating-long-tasks/scripts/src/validation/evidence-paths.ts";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Evidence Location Doctor Checks - p18 unified validator evidence location", () => {
  test("isUnifiedEvidenceRelativePath validates relative evidence paths", () => {
    expect(isUnifiedEvidenceRelativePath("evidence")).toBe(true);
    expect(isUnifiedEvidenceRelativePath("evidence/screenshots/proof.png")).toBe(true);
    expect(isUnifiedEvidenceRelativePath("evidence/manifests/screen.json")).toBe(true);
    expect(isUnifiedEvidenceRelativePath("evidence/visual-report.json")).toBe(true);

    expect(isUnifiedEvidenceRelativePath("screenshots/proof.png")).toBe(false);
    expect(isUnifiedEvidenceRelativePath("src/proof.png")).toBe(false);
    expect(isUnifiedEvidenceRelativePath("../evidence/proof.png")).toBe(false);
    expect(isUnifiedEvidenceRelativePath("/tmp/proof.png")).toBe(false);
  });

  test("formatUnifiedEvidencePath creates correct canonical paths", () => {
    expect(formatUnifiedEvidencePath("desktop.png", "screenshots")).toBe(
      "evidence/screenshots/desktop.png",
    );
    expect(formatUnifiedEvidencePath("manifest.json", "manifests")).toBe(
      "evidence/manifests/manifest.json",
    );
    expect(formatUnifiedEvidencePath("report.json", "reports")).toBe("evidence/report.json");
  });

  test("verifyUnifiedEvidenceLocation passes when captures use unified evidence paths", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-evid-valid-"));
    roots.push(repo);
    const runRoot = join(repo, ".capsules", "run-evid-1");
    await mkdir(join(runRoot, "evidence", "screenshots"), { recursive: true });

    const capturesData = {
      schema: "harness.captures",
      version: 1,
      captures: [
        {
          kind: "screenshot",
          name: "desktop.png",
          sha256: "a".repeat(64),
          bytes: 2048,
          blob_path: "blobs/a".repeat(64),
          path: "evidence/screenshots/desktop.png",
          storage: "copy",
          original_path: "/tmp/orig.png",
        },
        {
          kind: "visual_report",
          name: "visual-report.json",
          sha256: "b".repeat(64),
          bytes: 1024,
          blob_path: "blobs/b".repeat(64),
          path: "evidence/visual-report.json",
          storage: "copy",
          original_path: "/tmp/orig-report.json",
        },
      ],
      updated_at: new Date().toISOString(),
    };

    await writeFile(join(runRoot, "captures.json"), JSON.stringify(capturesData));

    const audit = verifyUnifiedEvidenceLocation(runRoot);
    expect(audit.valid).toBe(true);
    expect(audit.invalidCount).toBe(0);
    expect(audit.issues).toHaveLength(0);
  });

  test("verifyUnifiedEvidenceLocation flags captures with non-unified evidence paths", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-evid-invalid-"));
    roots.push(repo);
    const runRoot = join(repo, ".capsules", "run-evid-2");
    await mkdir(runRoot, { recursive: true });

    const capturesData = {
      schema: "harness.captures",
      version: 1,
      captures: [
        {
          kind: "screenshot",
          name: "rogue.png",
          sha256: "c".repeat(64),
          bytes: 2048,
          blob_path: "blobs/c".repeat(64),
          path: "screenshots/rogue.png", // Non-unified path! Should be evidence/screenshots/rogue.png
          storage: "copy",
          original_path: "/tmp/orig.png",
        },
      ],
      updated_at: new Date().toISOString(),
    };

    await writeFile(join(runRoot, "captures.json"), JSON.stringify(capturesData));

    const audit = verifyUnifiedEvidenceLocation(runRoot);
    expect(audit.valid).toBe(false);
    expect(audit.invalidCount).toBe(1);
    expect(audit.invalidPaths).toContain("screenshots/rogue.png");
    expect(
      audit.issues.some((i) =>
        i.includes("validator outputs must reside under .capsules/<run>/evidence/"),
      ),
    ).toBe(true);
  });

  test("verifyUnifiedEvidenceLocation audits validation finding evidence in state", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-evid-state-"));
    roots.push(repo);
    const runRoot = join(repo, ".capsules", "run-evid-3");
    await mkdir(runRoot, { recursive: true });

    const state: JsonObject = {
      tasks: {
        "task-ui-1": {
          id: "task-ui-1",
          status: "rejected",
          validations: [
            {
              validator_id: "val-1",
              findings: [
                {
                  id: "F-1",
                  observation: "Overflow detected",
                  evidence: [
                    { path: "evidence/screenshots/overflow.png" }, // valid
                    { path: "custom-out/shot.png" }, // invalid non-unified!
                  ],
                },
              ],
            },
          ],
        },
      },
    };

    const audit = verifyUnifiedEvidenceLocation(runRoot, state);
    expect(audit.valid).toBe(false);
    expect(audit.invalidCount).toBe(1);
    expect(audit.invalidPaths).toContain("custom-out/shot.png");
    expect(audit.issues.some((i) => i.includes("violates unified evidence policy"))).toBe(true);
  });
});
