import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  recordRepositoryInspection,
  repositoryInspectionContext,
  repositoryInspectionDigest,
  validateRepositoryInspectionPair,
} from "../../orchestrating-long-tasks/scripts/src/packets/repository-inspection.ts";
import { inspectRepositoryContent } from "../../orchestrating-long-tasks/scripts/src/packets/repository-content.ts";
import { repositoryContentPaths } from "../../orchestrating-long-tasks/scripts/src/packets/repository-content-paths.ts";
import { inspectRepositoryBinding } from "../../orchestrating-long-tasks/scripts/src/packets/repository-identity.ts";
import { initRun, loadRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";

const roots: string[] = [];
const scriptsRoot = fileURLToPath(new URL("../../orchestrating-long-tasks/scripts", import.meta.url));

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

function git(repo: string, args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Harness Test",
      GIT_AUTHOR_EMAIL: "harness@example.invalid",
      GIT_COMMITTER_NAME: "Harness Test",
      GIT_COMMITTER_EMAIL: "harness@example.invalid",
    },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), "repository-inspection-"));
  roots.push(repo);
  git(repo, ["init", "-q"]);
  await writeFile(join(repo, "AGENTS.md"), "# Instructions\n");
  await writeFile(join(repo, "package.json"), '{"scripts":{"test":"bun test"}}\n');
  git(repo, ["add", "AGENTS.md", "package.json"]);
  git(repo, ["commit", "-qm", "test: seed repository"]);
  const run = initRun(repo, "inspection-run", new TextEncoder().encode("Do work"), "file", true, {
    runtimeSource: scriptsRoot,
  });
  return { repo, run };
}

describe("audited repository inspections", () => {
  test("records immutable baseline and current snapshots with event-bound digests", async () => {
    const { repo, run } = await fixture();
    const baseline = recordRepositoryInspection(run, "planner", "baseline");
    expect(baseline.version).toBe(3);
    expect(baseline.repository_git_identity_sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(baseline.inspection_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(baseline.instruction_files).toContainEqual(
      expect.objectContaining({ path: "AGENTS.md" }),
    );
    await writeFile(join(repo, "src.ts"), "export const changed = true;\n");
    const current = recordRepositoryInspection(run, "coordinator", "current");
    expect(current.git.status_porcelain_v2.join("\n")).toContain("src.ts");
    const loaded = loadRun(run);
    const context = repositoryInspectionContext(loaded.state, true);
    expect(context.baseline_repository_state.inspection_sha256).toBe(baseline.inspection_sha256);
    expect(context.current_repository_state.inspection_sha256).toBe(current.inspection_sha256);
    expect(loaded.events.filter(({ kind }) => kind === "repository-inspected")).toHaveLength(2);
    expect(loaded.state.current_repository_binding).toEqual(
      expect.objectContaining({
        schema: "harness.repository-binding",
        version: 1,
        git_identity_sha256: current.repository_git_identity_sha256,
      }),
    );
  });

  test("rejects an invalid Git identity digest even when the inspection digest matches", async () => {
    const { run } = await fixture();
    const baseline = recordRepositoryInspection(run, "planner", "baseline");
    const invalid = { ...baseline, repository_git_identity_sha256: "invalid" };
    invalid.inspection_sha256 = repositoryInspectionDigest(invalid);
    expect(() =>
      validateRepositoryInspectionPair({
        baseline_repository_state: invalid,
        current_repository_state: { ...invalid, phase: "current" },
      }),
    ).toThrow("baseline repository inspection is invalid");
  });

  test("refuses missing, empty, and digest-tampered inspection authority", async () => {
    const { run } = await fixture();
    expect(() => repositoryInspectionContext(loadRun(run).state, true)).toThrow("baseline");
    recordRepositoryInspection(run, "planner", "baseline");
    expect(() => repositoryInspectionContext(loadRun(run).state, true)).toThrow("current");
    recordRepositoryInspection(run, "coordinator", "current");
    const state = structuredClone(loadRun(run).state);
    const digest = state.current_repository_inspection_sha256 as string;
    (state.repository_inspections as Record<string, Record<string, unknown>>)[digest]!.git = {};
    expect(() => repositoryInspectionContext(state, true)).toThrow("digest");
    const bindingDrift = structuredClone(loadRun(run).state);
    (bindingDrift.current_repository_binding as Record<string, unknown>).content_sha256 =
      "f".repeat(64);
    expect(() => repositoryInspectionContext(bindingDrift, true)).toThrow("binding");
  });

  test("does not replace the baseline on a later call", async () => {
    const { repo, run } = await fixture();
    const first = recordRepositoryInspection(run, "planner", "baseline");
    await writeFile(join(repo, "later.ts"), "export {};\n");
    const second = recordRepositoryInspection(run, "other", "baseline");
    expect(second).toEqual(first);
    expect(loadRun(run).events.filter(({ kind }) => kind === "repository-inspected")).toHaveLength(
      1,
    );
  });

  test("hashes tracked and nonignored untracked bytes while excluding harness and ignored bytes", async () => {
    const { repo } = await fixture();
    await writeFile(join(repo, ".gitignore"), "ignored.txt\n.harness/\n");
    await writeFile(join(repo, "untracked.txt"), "untracked one\n");
    await writeFile(join(repo, "ignored.txt"), "ignored one\n");
    await mkdir(join(repo, ".harness"), { recursive: true });
    await writeFile(join(repo, ".harness", "state.json"), "harness one\n");
    const first = inspectRepositoryContent(repo);

    await writeFile(join(repo, "AGENTS.md"), "# Changed tracked bytes\n");
    const tracked = inspectRepositoryContent(repo);
    expect(tracked.content_sha256).not.toBe(first.content_sha256);

    await writeFile(join(repo, "untracked.txt"), "untracked two\n");
    const untracked = inspectRepositoryContent(repo);
    expect(untracked.content_sha256).not.toBe(tracked.content_sha256);

    await writeFile(join(repo, "ignored.txt"), "ignored two\n");
    await writeFile(join(repo, ".harness", "state.json"), "harness two\n");
    expect(inspectRepositoryContent(repo)).toEqual(untracked);
  });

  test("hashes tracked symlinks by link bytes without following their targets", async () => {
    const { repo } = await fixture();
    await writeFile(join(repo, ".gitignore"), "ignored.txt\nother-ignored.txt\n");
    await writeFile(join(repo, "ignored.txt"), "first target bytes\n");
    await writeFile(join(repo, "other-ignored.txt"), "other target bytes\n");
    await symlink("ignored.txt", join(repo, "linked.md"));
    git(repo, ["add", ".gitignore", "linked.md"]);
    git(repo, ["commit", "-qm", "test: add tracked symlink"]);
    const first = inspectRepositoryContent(repo);

    await writeFile(join(repo, "ignored.txt"), "changed target bytes\n");
    expect(inspectRepositoryContent(repo)).toEqual(first);
    await rm(join(repo, "linked.md"));
    await symlink("other-ignored.txt", join(repo, "linked.md"));
    expect(inspectRepositoryContent(repo).content_sha256).not.toBe(first.content_sha256);
  });

  test("rejects bounded-scan overflow", async () => {
    const { repo } = await fixture();
    await writeFile(join(repo, "large.bin"), Buffer.alloc(32));
    expect(() => inspectRepositoryContent(repo, { maxTotalBytes: 16 })).toThrow("byte limit");
    expect(() => inspectRepositoryContent(repo, { maxFiles: 1 })).toThrow("file limit");
  });

  test("rejects a path listing that changes while repository bytes are scanned", async () => {
    const { repo } = await fixture();
    const stable = repositoryContentPaths(repo, 1024 * 1024);
    let scans = 0;
    expect(() =>
      inspectRepositoryContent(repo, {}, () =>
        scans++ === 0 ? stable : [...stable, "appeared-during-scan.ts"],
      ),
    ).toThrow("listing changed during scan");
  });

  test("rejects a symbolic-link ancestor of a tracked repository file", async () => {
    const { repo } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "repository-outside-"));
    roots.push(outside);
    await mkdir(join(repo, "linked-dir"));
    await writeFile(join(repo, "linked-dir", "tracked.txt"), "inside\n");
    git(repo, ["add", "linked-dir/tracked.txt"]);
    git(repo, ["commit", "-qm", "test: add nested tracked file"]);
    await rm(join(repo, "linked-dir"), { recursive: true });
    await writeFile(join(outside, "tracked.txt"), "outside\n");
    await symlink(outside, join(repo, "linked-dir"), "dir");
    expect(() => inspectRepositoryContent(repo, {}, () => ["linked-dir/tracked.txt"])).toThrow(
      "symbolic",
    );
  });

  test("stable binding detects chmod plus index add and reset", async () => {
    const { repo } = await fixture();
    const initial = inspectRepositoryBinding(repo);
    await mkdir(join(repo, ".harness"), { recursive: true });
    await writeFile(join(repo, ".harness", "runtime.json"), "harness-only bytes\n");
    git(repo, ["add", "-f", ".harness/runtime.json"]);
    expect(inspectRepositoryBinding(repo)).toEqual(initial);
    await chmod(join(repo, "AGENTS.md"), 0o755);
    const executable = inspectRepositoryBinding(repo);
    expect(executable.content_sha256).not.toBe(initial.content_sha256);
    expect(executable.inspection_sha256).not.toBe(initial.inspection_sha256);

    await writeFile(join(repo, "AGENTS.md"), "# staged bytes\n");
    const unstaged = inspectRepositoryBinding(repo);
    git(repo, ["add", "AGENTS.md"]);
    const staged = inspectRepositoryBinding(repo);
    expect(staged.content_sha256).not.toBe(unstaged.content_sha256);
    expect(staged.inspection_sha256).not.toBe(unstaged.inspection_sha256);
    git(repo, ["reset", "-q", "HEAD", "--", "AGENTS.md"]);
    expect(inspectRepositoryBinding(repo).inspection_sha256).not.toBe(staged.inspection_sha256);
  });

  test("stable binding detects same-tree HEAD and symbolic-ref movement", async () => {
    const { repo } = await fixture();
    const initial = inspectRepositoryBinding(repo);
    git(repo, ["commit", "--allow-empty", "-qm", "test: move head without tree drift"]);
    const movedHead = inspectRepositoryBinding(repo);
    expect(movedHead.content_sha256).toBe(initial.content_sha256);
    expect(movedHead.inspection_sha256).not.toBe(initial.inspection_sha256);

    git(repo, ["switch", "-qc", "same-tree-ref"]);
    const movedRef = inspectRepositoryBinding(repo);
    expect(movedRef.content_sha256).toBe(movedHead.content_sha256);
    expect(movedRef.inspection_sha256).not.toBe(movedHead.inspection_sha256);
  });
});
