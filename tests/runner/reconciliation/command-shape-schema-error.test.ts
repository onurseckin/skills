import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { RepositoryBinding } from "../../../olt/scripts/src/core/contracts/index.ts";
import { embeddedCommandIssues } from "../../../olt/scripts/src/engine/runner/models/command/command-shape.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupTempRoots, getRunnerVfs, tempRoot } from "../command/fixture.ts";

afterEach(cleanupTempRoots);

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
    const repositoryRoot = tempRoot("command-shape-schema-error");
    const vfs: VirtualMemoryFS = getRunnerVfs();
    vfs.mkdirSync(join(repositoryRoot, "bin"), { recursive: true });
    vfs.writeFileSync(join(repositoryRoot, "bin", "verify"), "#!/bin/sh\nexit 0\n", {
      mode: 0o700,
    });
    const runRoot = join(repositoryRoot, ".olt", "capsules");
    vfs.mkdirSync(runRoot, { recursive: true });
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

    const record = { ...prepared.record, repository_root: join(repositoryRoot, "no-such-dir") };
    const issues = embeddedCommandIssues(record);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^command record schema is invalid: /);
  });

  test("validates non-empty attempt evidence_issues containing valid and invalid elements", async () => {
    const repositoryRoot = tempRoot("command-shape-evidence-issues");
    const vfs: VirtualMemoryFS = getRunnerVfs();
    vfs.mkdirSync(join(repositoryRoot, "bin"), { recursive: true });
    vfs.writeFileSync(join(repositoryRoot, "bin", "verify"), "#!/bin/sh\nexit 0\n", {
      mode: 0o700,
    });
    const runRoot = join(repositoryRoot, ".olt", "capsules");
    vfs.mkdirSync(runRoot, { recursive: true });
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

    const recordWithValidIssues = {
      ...prepared.record,
      status: "failed" as const,
      attempts: [
        {
          attempt_index: 0,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          status: "failed" as const,
          exit_code: 1,
          signal: null,
          failure_class: "test_failure" as const,
          evidence_issues: ["output truncated", "unexpected token"],
          evidence_error: "test failed",
        },
      ],
    };
    const validIssues = embeddedCommandIssues(recordWithValidIssues);
    expect(validIssues.some((i) => i.includes("attempt evidence issues are invalid"))).toBe(false);

    const recordWithEmptyStringIssue = {
      ...prepared.record,
      status: "failed" as const,
      attempts: [
        {
          attempt_index: 0,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          status: "failed" as const,
          exit_code: 1,
          signal: null,
          failure_class: "test_failure" as const,
          evidence_issues: ["   "],
          evidence_error: "test failed",
        },
      ],
    };
    const invalidIssues = embeddedCommandIssues(recordWithEmptyStringIssue);
    expect(invalidIssues).toContain("attempt evidence issues are invalid");
  });
});
