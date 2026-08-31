import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateProofRecord, GateSpawn } from "../../../olt/scripts/src/graph/gate-proof.ts";
import type {
  RepositoryGitCommand,
  RepositoryGitResult,
} from "../../../olt/scripts/src/packets/repository-git-command.ts";

const trackedProofRepos: string[] = [];

/** A directory carrying only a real `.git` marker — `hasRepositoryGitMetadata` only needs that
 *  directory to exist; every actual `git` invocation is intercepted by the fake below instead. */
export function repoWithoutRealGit(_label?: string): string {
  const repo = mkdtempSync(join(tmpdir(), "gate-proof-fixture-"));
  trackedProofRepos.push(repo);
  mkdirSync(join(repo, ".git"), { recursive: true });
  return repo;
}

export function cleanupProofRepos(): void {
  for (const repo of trackedProofRepos.splice(0)) {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in temporary directory
    }
  }
}

/** Scripts `repositoryGit` by argv[0] (ls-files / ls-tree / show). */
export function fakeGit(script: Record<string, RepositoryGitResult>): RepositoryGitCommand {
  return (_repo: string, argv: readonly string[]): RepositoryGitResult => {
    const verb = argv[0] ?? "";
    const scripted = script[verb];
    if (!scripted) throw new Error(`fakeGit: no script for ${argv.join(" ")}`);
    return scripted;
  };
}

export const noopSpawn: GateSpawn = () => ({
  status: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
});

/** Stands in for the real gate subprocess: reads the scratch-copy filesystem and checks conditions. */
export function fsCheckSpawn(check: (cwd: string) => boolean): GateSpawn {
  return (_argv: readonly string[], cwd: string) => ({
    status: check(cwd) ? 0 : 1,
    stdout: "",
    stderr: "",
    timedOut: false,
  });
}

export function record(overrides: Partial<GateProofRecord> = {}): GateProofRecord {
  return {
    task_id: "task-1",
    gate_argv: ["bun", "test", "tests/db.test.ts"],
    write_scope: ["src/db"],
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-08-20T00:00:00.000Z",
    actor: "coordinator",
    ...overrides,
  };
}
