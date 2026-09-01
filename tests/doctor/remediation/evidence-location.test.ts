import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { verifyUnifiedEvidenceLocation } from "../../../olt/scripts/src/reporting/doctor/evidence-location.ts";
import {
  isUnifiedEvidenceRelativePath,
  formatUnifiedEvidencePath,
} from "../../../olt/scripts/src/validation/reporters/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";

export const evidenceLocationSuiteName =
  "Evidence Location Doctor Checks - p18 unified validator evidence location";

interface VirtualNode {
  isDir: boolean;
  content?: string;
}

const vfs = new Map<string, VirtualNode>();
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs.clear();
  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = String(p).replace(/\/+$/, "");
    if (vfs.has(s)) return true;
    const prefix = `${s}/`;
    for (const k of vfs.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  });
  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
    const s = String(p);
    const n = vfs.get(s);
    if (!n || n.content === undefined) throw new Error(`ENOENT: ${s}`);
    return n.content;
  });
  spies.push(existsSpy, readSpy);
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
});

describe(evidenceLocationSuiteName, () => {
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

  test("verifyUnifiedEvidenceLocation passes when captures use unified evidence paths", () => {
    setupVirtualFs();
    const repo = "/virtual/repo-evid-valid";
    const runRoot = join(repo, ".olt", "capsules", "run-evid-1");
    vfs.set(join(runRoot, "evidence", "screenshots"), { isDir: true });

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

    vfs.set(join(runRoot, "captures.json"), {
      content: JSON.stringify(capturesData),
      isDir: false,
    });

    const audit = verifyUnifiedEvidenceLocation(runRoot);
    expect(audit.valid).toBe(true);
    expect(audit.invalidCount).toBe(0);
    expect(audit.issues).toHaveLength(0);
  });

  test("verifyUnifiedEvidenceLocation flags captures with non-unified evidence paths", () => {
    setupVirtualFs();
    const repo = "/virtual/repo-evid-invalid";
    const runRoot = join(repo, ".olt", "capsules", "run-evid-2");
    vfs.set(runRoot, { isDir: true });

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
          path: "screenshots/rogue.png",
          storage: "copy",
          original_path: "/tmp/orig.png",
        },
      ],
      updated_at: new Date().toISOString(),
    };

    vfs.set(join(runRoot, "captures.json"), {
      content: JSON.stringify(capturesData),
      isDir: false,
    });

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

  test("verifyUnifiedEvidenceLocation audits validation finding evidence in state", () => {
    setupVirtualFs();
    const repo = "/virtual/repo-evid-state";
    const runRoot = join(repo, ".olt", "capsules", "run-evid-3");
    vfs.set(runRoot, { isDir: true });

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
                    { path: "evidence/screenshots/overflow.png" },
                    { path: "custom-out/shot.png" },
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
