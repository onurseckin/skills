import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "./full-lifecycle-fixture.ts";

export const GATE_SCRIPT = "gate-check.ts";

export function runStateAssertion(): string[] {
  return ["bun", GATE_SCRIPT];
}

export async function cleanupRoots(roots: string[]): Promise<void> {
  cleanupVirtualCliFS();
  roots.splice(0);
}

export async function writeJson(root: string, name: string, value: unknown): Promise<string> {
  const path = join(root, name);
  await writeFile(path, JSON.stringify(value));
  return path;
}

export function cleanCompletionReview(
  packetSha256: unknown,
  readinessSha256: unknown,
  repositoryBinding: unknown,
  runGate: string,
  criticCheck: string,
) {
  return {
    packet_id: "critic-1",
    packet_sha256: packetSha256,
    readiness_sha256: readinessSha256,
    repository_binding: repositoryBinding,
    graph_revision: 1,
    status: "clean",
    unresolved_finding_ids: [],
    findings: [],
    integrity_evidence: [{ status: "passed", issues: [] }],
    repository_command_ids: [runGate],
    checks: [{ command_id: criticCheck }],
    requirement_proofs: [
      {
        requirement_id: "R-001",
        status: "satisfied",
        evidence: [
          {
            kind: "state",
            reference: "requirement:R-001",
            observation: "task validation and mandatory gate satisfied the requirement",
          },
        ],
      },
    ],
    residual_risks: [],
  };
}

export async function successfulCommand(
  run: string,
  repo: string,
  actor: string,
  task?: string,
  gate?: string,
): Promise<string> {
  const result = await execute([
    "run",
    "--run",
    run,
    "--actor",
    actor,
    "--cwd",
    repo,
    ...(task ? ["--task", task] : []),
    ...(gate ? ["--gate", gate] : []),
    "--",
    ...runStateAssertion(basename(run)),
  ]);
  return (result.record as { id: string }).id;
}

/** A freshly plan:init'd run with a throwaway repo and a synthetic multi-line prompt. */
export async function freshRun(
  name: string,
  roots: string[],
  promptLines: string[] = ["Line one", "Line two", "Line three"],
): Promise<{ repo: string; run: string }> {
  setupVirtualCliFS();
  const repo = `/virtual/cli/plan-workflow-${name}-${Math.random().toString(36).slice(2)}`;
  roots.push(repo);
  await mkdir(join(repo, ".git"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, promptLines.join("\n"));
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, run: init.run_root as string };
}

export function mockGitSpawnSync(
  cmd: string,
  args: string[] = [],
  opts: { cwd?: string; encoding?: string } = {},
  repoRoot: string,
  committedBlobs: Map<string, string>,
  fsModule: typeof import("node:fs"),
  pathResolve: typeof import("node:path").resolve,
) {
  const s = args.join(" "),
    enc = opts.encoding === "utf8",
    out = (t: string) => (enc ? t : Buffer.from(t));
  if (
    s.includes("missing-shell-input") ||
    s.includes("exit 1") ||
    cmd === "false" ||
    args[0] === "false"
  ) {
    return { status: 1, stdout: out(""), stderr: out("mock command error") };
  }
  if (cmd.startsWith("test -f ") || (cmd === "test" && args[0] === "-f")) {
    const p = pathResolve(
      opts.cwd ?? process.cwd(),
      cmd.startsWith("test -f ") ? cmd.slice(8).trim() : args[1]!,
    );
    return fsModule.existsSync(p)
      ? { status: 0, stdout: out(""), stderr: out("") }
      : { status: 1, stdout: out(""), stderr: out("File not found") };
  }
  if (s.includes("commit") && s.includes("feature landed")) {
    committedBlobs.set("feature.ts", "export const x = 1;\n");
    return { status: 0, stdout: out(""), stderr: out("") };
  }
  if (s.includes("ls-tree") && s.includes("HEAD") && committedBlobs.has("feature.ts")) {
    return {
      status: 0,
      stdout: out("100644 blob 0123456789abcdef\tfeature.ts\n"),
      stderr: out(""),
    };
  }
  if (
    s.includes("show") &&
    s.includes("HEAD") &&
    s.includes("feature.ts") &&
    committedBlobs.has("feature.ts")
  ) {
    return { status: 0, stdout: out("export const x = 1;\n"), stderr: out("") };
  }
  const cIdx = args.indexOf("-C"),
    target = (cIdx !== -1 ? args[cIdx + 1] : undefined) ?? opts.cwd ?? repoRoot;
  if (s.includes("--git-path"))
    return {
      status: 0,
      stdout: out(
        `${join(target, ".git", args[args.indexOf("--git-path") + 1] ?? "config.worktree")}\n`,
      ),
      stderr: out(""),
    };
  if (s.includes("--git-dir") || s.includes("--git-common-dir") || s.includes("--absolute-git-dir"))
    return { status: 0, stdout: out(`${join(target, ".git")}\n`), stderr: out("") };
  if (s.includes("rev-parse --show-toplevel"))
    return { status: 0, stdout: out(`${target}\n`), stderr: out("") };
  if (s.includes("rev-parse --is-inside-work-tree"))
    return { status: 0, stdout: out("true\n"), stderr: out("") };
  if (s.includes("rev-parse") && s.includes("HEAD"))
    return {
      status: 0,
      stdout: out("0123456789abcdef0123456789abcdef01234567\n"),
      stderr: out(""),
    };
  if (s.includes("symbolic-ref"))
    return { status: 0, stdout: out("refs/heads/main\n"), stderr: out("") };
  if (args.includes("status") && s.includes("--porcelain=v1"))
    return { status: 0, stdout: out(" M tests/core/probe-target.ts\0"), stderr: out("") };
  if (args.includes("status") && s.includes("-z"))
    return {
      status: 0,
      stdout: out("# branch.oid 0123456789abcdef0123456789abcdef01234567\0# branch.head main\0"),
      stderr: out(""),
    };
  if (s.includes("ls-files") && s.includes("--others"))
    return { status: 0, stdout: out(""), stderr: out("") };
  const candidates = [
    "tests/core/probe-target.ts",
    "tests/t1/impl.ts",
    "feature.ts",
    "gate-core.ts",
    "gate-t1.ts",
    "tests/run.test.ts",
    "README.md",
  ];
  const staged = candidates.find((c) => fsModule.existsSync(join(target, c)));
  if (s.includes("ls-files") && s.includes("--stage"))
    return staged
      ? {
          status: 0,
          stdout: out(`100644 0123456789abcdef0123456789abcdef01234567 0\t${staged}\0`),
          stderr: out(""),
        }
      : { status: 0, stdout: out(""), stderr: out("") };
  if (s.includes("ls-files"))
    return staged
      ? { status: 0, stdout: out(`${staged}\0`), stderr: out("") }
      : { status: 0, stdout: out(""), stderr: out("") };
  if (s.includes("diff")) {
    const changed = committedBlobs.has("feature.ts") ? "feature.ts" : staged;
    return changed
      ? { status: 0, stdout: out(`${changed}\n`), stderr: out("") }
      : { status: 0, stdout: out(""), stderr: out("") };
  }
  return { status: 0, stdout: out(""), stderr: out("") };
}
