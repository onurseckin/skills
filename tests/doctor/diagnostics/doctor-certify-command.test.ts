import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { doctorCertifyCommand } from "../../../olt/scripts/src/reporting/doctor/certify-command.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  mockSubprocess,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const doctorCertifyCommandSuiteName = "doctor:certify command suite";

let vfs: VirtualMemoryFS = new VirtualMemoryFS();
let session: VirtualFSSession | null = null;
let subprocMock: { mockRestore: () => void } | null = null;

const certify = (flags: Record<string, unknown>) => doctorCertifyCommand(flags as unknown as Flags);

function setupVirtualFs(): void {
  if (session) session.cleanup();
  if (subprocMock) subprocMock.mockRestore();

  const cwd = process.cwd();
  vfs = new VirtualMemoryFS();
  vfs.mkdirSync(cwd, { recursive: true });
  vfs.mkdirSync(join(cwd, ".git"), { recursive: true });
  vfs.writeFileSync(join(cwd, "package.json"), "{}");
  vfs.chdir(cwd);
  session = createVirtualFSSession(vfs);

  subprocMock = mockSubprocess((_cmd, args) => {
    const tf = (args ?? []).find((a) => typeof a === "string" && a.endsWith(".test.ts"));
    if (tf && vfs.existsSync(tf)) {
      const c = vfs.readFileSync(tf, "utf-8").trim();
      const valid =
        `import { test, expect } from "bun:test";\ntest("falsifiable", () => { expect(1 + 1).toBe(2); });`.trim();
      if (c !== valid) {
        return {
          status: 1,
          stdout: "",
          stderr: "Mutation failed as expected",
          error: undefined,
        };
      }
    }
    return {
      status: 0,
      stdout: "1 pass",
      stderr: "",
      error: undefined,
    };
  });
}

afterEach(() => {
  if (subprocMock) {
    subprocMock.mockRestore();
    subprocMock = null;
  }
  if (session) {
    session.cleanup();
    session = null;
  }
});

function initVirtualCapsule(label: string): { repo: string; runRoot: string } {
  const repo = `/virtual/repo-${label}`;
  vfs.mkdirSync(repo, { recursive: true });
  vfs.mkdirSync(`${repo}/.git`, { recursive: true });
  vfs.mkdirSync(`${repo}/.olt/capsules`, { recursive: true });
  return {
    repo,
    runRoot: initRun(
      repo,
      `run-${label}`,
      new TextEncoder().encode("Prompt for test."),
      "file",
      true,
    ),
  };
}

function setupNonCanonRun(label: string): string {
  const repo = `/virtual/repo-${label}`;
  vfs.mkdirSync(repo, { recursive: true });
  vfs.mkdirSync(`${repo}/.git`, { recursive: true });
  const runRoot = initRun(
    repo,
    "non-canon-run",
    new TextEncoder().encode("Prompt for test."),
    "file",
    true,
  );
  const target = `${repo}/nested/custom-capsules/${label}`;
  const tree = vfs.dumpTree();
  for (const [k, v] of Object.entries(tree)) {
    if (k.startsWith(runRoot)) {
      const dest = `${target}${k.slice(runRoot.length)}`;
      const parentDir = dest.slice(0, dest.lastIndexOf("/"));
      vfs.mkdirSync(parentDir, { recursive: true });
      vfs.writeFileSync(dest, v);
    }
  }
  return target;
}

describe(doctorCertifyCommandSuiteName, () => {
  test("rejects a --write-scope path that is not a .test.ts or .spec.ts file, instead of silently skipping it", async () => {
    setupVirtualFs();
    const { runRoot } = initVirtualCapsule("certify-non-test-scope");
    const nonTest = "/virtual/src/some-helper.ts";
    vfs.mkdirSync("/virtual/src", { recursive: true });
    vfs.writeFileSync(nonTest, "export const x = 1;\n");
    await expect(certify({ run: runRoot, "write-scope": nonTest })).rejects.toThrow(
      "--write-scope must name a .test.ts or .spec.ts file",
    );
  });

  test("runs the non-adversarial health diagnostics and certifies a clean, canonically-placed capsule with no --write-scope", async () => {
    setupVirtualFs();
    const { runRoot } = initVirtualCapsule("certify-baseline-run");
    const report = await certify({ run: runRoot });
    const healthChecks = report["healthChecks"] as readonly { status: string }[];
    expect(report["adversarialChecks"]).toEqual([]);
    expect(healthChecks.length > 0 && healthChecks.every((check) => check.status === "pass")).toBe(
      true,
    );
    expect(report["certified"]).toBe(true);
  });

  test("--strict throws when the capsule root is not under the canonical location", async () => {
    setupVirtualFs();
    const nonCanonRunRoot = setupNonCanonRun("certify-strict");
    await expect(certify({ run: nonCanonRunRoot, strict: true })).rejects.toThrow();
  });

  test("without --strict, an uncertified capsule root still returns a report rather than throwing", async () => {
    setupVirtualFs();
    const nonCanonRunRoot = setupNonCanonRun("certify-nostrict");
    const report = await certify({ run: nonCanonRunRoot });
    const healthChecks = report["healthChecks"] as readonly { name: string; status: string }[];
    expect(report["certified"]).toBe(false);
    expect(healthChecks.find((c) => c.name === "capsule_root_confinement")?.status).toBe("fail");
  });

  test("proves a trivially-passing test is falsifiable via a real counterfactual mutation round-trip", async () => {
    setupVirtualFs();
    const { repo, runRoot } = initVirtualCapsule("certify-adversarial-round-trip");
    const testFile = join(repo, "tests", "corrupted-falsifiable.test.ts");
    vfs.mkdirSync(join(repo, "tests"), { recursive: true });
    vfs.writeFileSync(
      testFile,
      `import { test, expect } from "bun:test";\ntest("falsifiable", () => { expect(1 + 1).toBe(2); });\n`,
    );
    const report = await certify({ run: runRoot, "write-scope": testFile });
    const adversarial = report["adversarialChecks"] as readonly { passed: boolean }[];
    expect(adversarial.length > 0 && adversarial.every((check) => check.passed)).toBe(true);
    expect(report["certified"]).toBe(true);
  });
});
