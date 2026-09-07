import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import {
  findRepoRoot,
  isInsideCapsule,
  resolveOltDir,
  resolveCapsulesDir,
  resolvePolicyPath,
  resolveBacklogPath,
  resolveCompletedTasksPath,
  resolveDefectsPath,
  resolveCompletedDefectsPath,
  resolveTelemetryPath,
  resolveScratchDir,
  resolveEvidenceDir,
  stripCapsulePath,
} from "../../../olt/scripts/src/core/shared/paths.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Shared Path Resolvers", () => {
  let session: VirtualFSSession;
  let vfs: VirtualMemoryFS;
  const virtualRepo = "/virtual/shared-paths-repo";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(virtualRepo, { recursive: true });
    vfs.mkdirSync(`${virtualRepo}/.git`, { recursive: true });
    vfs.mkdirSync(`${virtualRepo}/.olt`, { recursive: true });
    vfs.mkdirSync(`${virtualRepo}/.olt/capsules`, { recursive: true });
    vfs.writeFileSync(`${virtualRepo}/package.json`, JSON.stringify({ name: "mock-repo" }));
    vfs.chdir(virtualRepo);
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  it("finds repository root correctly", () => {
    const root = findRepoRoot();
    expect(root).toBe(virtualRepo);
    expect(vfs.existsSync(root)).toBe(true);
    expect(vfs.existsSync(`${root}/package.json`)).toBe(true);

    const explicitRoot = findRepoRoot(virtualRepo);
    expect(explicitRoot).toBe(virtualRepo);
  });

  it("identifies inside-capsule paths with isInsideCapsule and stripCapsulePath", () => {
    expect(isInsideCapsule("/mock/repo/.olt/capsules/run-abc")).toBe(true);
    expect(isInsideCapsule("/mock/repo/.capsules/run-abc")).toBe(true);
    expect(isInsideCapsule("/mock/repo/src/core/paths.ts")).toBe(false);
    expect(isInsideCapsule("/mock/repo/src/capsules/test.ts")).toBe(false);

    expect(stripCapsulePath("/mock/repo/.olt/capsules/run-abc/task")).toBe("/mock/repo");
    expect(stripCapsulePath("/mock/repo/src/core/paths.ts")).toBeUndefined();
  });

  it("resolves canonical .olt directory", () => {
    const oltDir = resolveOltDir(virtualRepo);
    expect(oltDir.endsWith(".olt") || oltDir.endsWith("olt")).toBe(true);
    expect(oltDir).toBe(`${virtualRepo}/.olt`);
  });

  it("resolves canonical .olt/capsules directory", () => {
    const capsulesDir = resolveCapsulesDir(virtualRepo);
    expect(capsulesDir).toContain("capsules");
    expect(capsulesDir).toBe(`${virtualRepo}/.olt/capsules`);
  });

  it("resolves policy, backlog, defects, and telemetry paths", () => {
    expect(resolvePolicyPath()).toContain("policy.json");
    expect(resolveBacklogPath()).toContain("backlog.jsonl");
    expect(resolveCompletedTasksPath()).toContain("completed-tasks.jsonl");
    expect(resolveDefectsPath()).toContain("defects.jsonl");
    expect(resolveCompletedDefectsPath()).toContain("completed-defects.jsonl");
    expect(resolveTelemetryPath()).toContain("telemetry.jsonl");
  });

  it("resolves scratch and evidence directories strictly under OS tmpdir", () => {
    const scratch = resolveScratchDir();
    expect(scratch).toContain("olt-scratch");

    const evidence = resolveEvidenceDir();
    expect(evidence).toContain("olt-scratch");
    expect(evidence).toContain("evidence");
  });

  it("walks up and resolves repo root from deeply nested virtual subdirectories", () => {
    const deepDir = `${virtualRepo}/deep/nested/sub/dir`;
    vfs.mkdirSync(deepDir, { recursive: true });

    const root = findRepoRoot(deepDir);
    expect(root).toBe(virtualRepo);
  });

  it("throws HarnessError with PATH_SAFETY when no repository anchor exists", () => {
    const orphanDir = "/virtual/isolated-orphan";
    vfs.mkdirSync(orphanDir, { recursive: true });

    expect(() => findRepoRoot(orphanDir)).toThrow();
  });
});
