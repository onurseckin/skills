import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepositoryBinding } from "../../../orchestrating-long-tasks/scripts/src/contracts/repository.ts";
import { embeddedCommandIssues } from "../../../orchestrating-long-tasks/scripts/src/runner/command-shape.ts";
import { createInternalCommandRunner } from "../../../orchestrating-long-tasks/scripts/src/runner/internal-command-runner.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function binding(): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: "a".repeat(64),
    git_identity_sha256: "a".repeat(64),
    content_sha256: "a".repeat(64),
    file_count: 1,
    total_bytes: 17,
  };
}

describe("embeddedCommandIssues schema-error fallback", () => {
  test("turns an unexpected exception during shape checking into a single schema-invalid issue", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "command-shape-schema-error-"));
    roots.push(repositoryRoot);
    await mkdir(join(repositoryRoot, "bin"));
    await writeFile(join(repositoryRoot, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const runRoot = join(repositoryRoot, ".capsules");
    await mkdir(runRoot, { recursive: true });
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding(),
      attempt: async () => {
        throw new Error("must not run");
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: repositoryRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });

    // repository_root is read with realpathSync deep inside commandShapeIssues; pointing it at a
    // path that no longer exists makes that call throw instead of returning a shape issue, which
    // is exactly the path embeddedCommandIssues' try/catch fallback exists to convert cleanly.
    const record = { ...prepared.record, repository_root: join(repositoryRoot, "no-such-dir") };
    const issues = embeddedCommandIssues(record);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^command record schema is invalid: /);
  });
});
