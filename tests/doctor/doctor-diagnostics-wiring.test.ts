import { afterEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { initRun } from "../../olt/scripts/src/engine/store/index.ts";
import { recordCaptures } from "../../olt/scripts/src/engine/store/capsule/captures.ts";
import { runDoctor } from "../../olt/scripts/src/reporting/doctor.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("runDoctor wires capsule-root and evidence-location checks", () => {
  test("a freshly initialised capsule under the canonical .olt/capsules/ layout stays healthy", async () => {
    const repo = scratchRoot(import.meta.path, "clean-init");
    const runRoot = initRun(repo, "clean-run", new TextEncoder().encode("Prompt."), "file", true);

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(true);
    expect((report.issues as string[]).some((issue) => issue.includes("capsule root"))).toBe(false);
  });

  test("runDoctor flags a misplaced bare capsules/ directory elsewhere in the same repository", async () => {
    const repo = scratchRoot(import.meta.path, "bare-capsules-repo");
    const runRoot = initRun(
      repo,
      "run-with-bad-sibling",
      new TextEncoder().encode("Prompt."),
      "file",
      true,
    );
    await mkdir(join(repo, "capsules", "stray-run"), { recursive: true });

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(false);
    expect(
      (report.issues as string[]).some(
        (issue) => issue.includes("Bare") && issue.includes(join(repo, "capsules")),
      ),
    ).toBe(true);
  });

  test("runDoctor flags a capture recorded at a non-unified evidence path", async () => {
    const repo = scratchRoot(import.meta.path, "bad-evidence-path");
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
