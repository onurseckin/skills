import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateRepositoryBinding } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/repository-binding.ts";

const skillRoot = join(import.meta.dir, "..", "..", "..", "orchestrating-long-tasks");

function completionReviewExample(): Record<string, unknown> {
  const cli = readFileSync(join(skillRoot, "references", "cli.md"), "utf8");
  const match = /The `review-completion[\s\S]*?```json\n([\s\S]*?)\n```/u.exec(cli);
  if (!match) throw new Error("completion review example is missing");
  return JSON.parse(match[1]!);
}

describe("operator reference examples", () => {
  test("keeps the documented completion repository binding runtime-valid", () => {
    const example = completionReviewExample();
    const documented = example.repository_binding as Record<string, unknown>;
    expect(documented).toEqual({
      schema: "harness.repository-binding",
      version: 1,
      inspection_sha256: "<sha256 from the critic packet>",
      git_identity_sha256: "<Git identity sha256 from the critic packet>",
      content_sha256: "<sha256 from the critic packet>",
      file_count: 123,
      total_bytes: 456789,
    });
    expect(
      validateRepositoryBinding(
        {
          ...documented,
          inspection_sha256: "a".repeat(64),
          git_identity_sha256: "b".repeat(64),
          content_sha256: "c".repeat(64),
        },
        "documented completion review repository binding",
      ),
    ).toEqual({
      schema: "harness.repository-binding",
      version: 1,
      inspection_sha256: "a".repeat(64),
      git_identity_sha256: "b".repeat(64),
      content_sha256: "c".repeat(64),
      file_count: 123,
      total_bytes: 456789,
    });
  });

  test("describes implementer submissions as trusted-host observed evidence", () => {
    const implementer = readFileSync(
      join(skillRoot, "scripts", "assets", "implementer.md"),
      "utf8",
    );
    expect(implementer).toContain("trusted-host observed evidence");
    expect(implementer).not.toContain("reproducible evidence");
  });

  test("documents restricted Git execution and versioned path caps without assurance inflation", () => {
    const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
    const protocol = readFileSync(join(skillRoot, "references", "protocol.md"), "utf8");
    const state = readFileSync(join(skillRoot, "references", "state-model.md"), "utf8");
    const cli = readFileSync(join(skillRoot, "references", "cli.md"), "utf8");
    expect(skill).toContain("repository-local `diff.external`, `diff.*.textconv`, active");
    expect(skill).toContain("`filter.*.clean`, `filter.*.smudge`, or `filter.*.process`");
    expect(protocol).toContain("declared Git gate argv and fingerprint remain unchanged");
    expect(protocol).toContain("Declared Git and wrapper executable names must be bare");
    expect(protocol).toContain("persisted `execution_argv`");
    expect(protocol).toContain("`GIT_NO_REPLACE_OBJECTS=1`");
    expect(protocol).toContain("Indexed gitlinks are rejected before porcelain status");
    expect(protocol).toContain("rejected before command intent publication or process spawn");
    expect(state).toContain("`harness.repository-content-scan-policy` version 1");
    expect(state).toContain("Non-regular, non-symlink leaves are rejected before open");
    expect(state).toContain("deliberately does not recursively traverse objects, refs, or the");
    expect(state).toContain("only to the spawned Git child, never a process group, ancestor");
    expect(cli).toContain("Packet Git subprocesses use the same restricted command seam");
    for (const document of [skill, protocol, state, cli])
      expect(document).toContain("trusted_host_observed_v1");
  });
});
