import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { recordCaptures } from "../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor.ts";

export const doctorDiagnosticsWiringSuiteName = "runDoctor wires capsule-root and evidence-location checks";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRepo(label: string): string {
  const repo = mkdtempSync(join(tmpdir(), `wiring-${label}-`));
  roots.push(repo);
  mkdirSync(join(repo, ".git"), { recursive: true });
  return repo;
}

describe(doctorDiagnosticsWiringSuiteName, () => {
  test("a freshly initialised capsule under the canonical .olt/capsules/ layout stays healthy", async () => {
    const repo = createRepo("clean-init");
    const runRoot = initRun(repo, "clean-run", new TextEncoder().encode("Prompt."), "file", true);

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(true);
    expect((report.issues as string[]).some((issue) => issue.includes("capsule root"))).toBe(false);
  });

  test("runDoctor flags a misplaced bare capsules/ directory elsewhere in the same repository", async () => {
    const repo = createRepo("bare-capsules-repo");
    const runRoot = initRun(
      repo,
      "run-with-bad-sibling",
      new TextEncoder().encode("Prompt."),
      "file",
      true,
    );
    mkdirSync(join(repo, "capsules", "stray-run"), { recursive: true });

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(false);
    expect(
      (report.issues as string[]).some(
        (issue) => issue.includes("Bare") && issue.includes(join(repo, "capsules")),
      ),
    ).toBe(true);
  });

  test("runDoctor flags a capture recorded at a non-unified evidence path", async () => {
    const repo = createRepo("bad-evidence-path");
    const runRoot = initRun(
      repo,
      "run-with-bad-evidence",
      new TextEncoder().encode("Prompt."),
      "file",
      true,
    );
    recordCaptures(runRoot, [
      {
        kind: "screenshot",
        name: "rogue.png",
        sha256: "d".repeat(64),
        bytes: 1024,
        blob_path: `blobs/${"d".repeat(64)}`,
        path: "screenshots/rogue.png",
        storage: "copy",
        original_path: "/somewhere/orig.png",
      },
    ]);

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(false);
    expect(
      (report.issues as string[]).some(
        (issue) => issue.includes("evidence") && issue.includes("screenshots/rogue.png"),
      ),
    ).toBe(true);
  });
});
