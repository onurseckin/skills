import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { recordCaptures } from "../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor.ts";
import * as agentCanonical from "../../../olt/scripts/src/reporting/doctor/agent-canonical-engine.ts";
import * as socratic2 from "../../../olt/scripts/src/reporting/socratic-validator/evaluators-2.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const doctorDiagnosticsWiringSuiteName =
  "runDoctor wires capsule-root and evidence-location checks";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession | null = null;
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs = new VirtualMemoryFS();
  vfs.mkdirSync(process.cwd(), { recursive: true });
  vfs.mkdirSync(join(process.cwd(), ".git"), { recursive: true });
  vfs.writeFileSync(join(process.cwd(), "package.json"), "{}");
  session = createVirtualFSSession(vfs);

  spies.push(
    spyOn(agentCanonical, "checkAgentCanonicalAlignment").mockReturnValue({
      engine: "checkAgentCanonicalAlignment",
      findings: [],
    }),
    spyOn(socratic2, "evaluateTwoKeyValidatorPairing").mockReturnValue([]),
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  session?.cleanup();
  session = null;
});

function createVirtualRepo(label: string): string {
  const repo = `/virtual/repo-${label}`;
  vfs.mkdirSync(join(repo, ".git"), { recursive: true });
  return repo;
}

describe(doctorDiagnosticsWiringSuiteName, () => {
  test("a freshly initialised capsule under the canonical .olt/capsules/ layout stays healthy", async () => {
    setupVirtualFs();
    const repo = createVirtualRepo("clean-init");
    const runRoot = initRun(repo, "clean-run", new TextEncoder().encode("Prompt."), "file", true);

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(true);
    expect((report.issues as string[]).some((issue) => issue.includes("capsule root"))).toBe(false);
  });

  test("runDoctor flags a misplaced bare capsules/ directory elsewhere in the same repository", async () => {
    setupVirtualFs();
    const repo = createVirtualRepo("bare-capsules-repo");
    const runRoot = initRun(
      repo,
      "run-with-bad-sibling",
      new TextEncoder().encode("Prompt."),
      "file",
      true,
    );
    vfs.mkdirSync(join(repo, "capsules", "stray-run"), { recursive: true });

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(false);
    expect(
      (report.issues as string[]).some(
        (issue) => issue.includes("Bare") && issue.includes(join(repo, "capsules")),
      ),
    ).toBe(true);
  });

  test("runDoctor flags a capture recorded at a non-unified evidence path", async () => {
    setupVirtualFs();
    const repo = createVirtualRepo("bad-evidence-path");
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
