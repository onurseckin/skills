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
    for (const document of [skill, protocol, state])
      expect(document).toContain("trusted_host_observed_v1");
  });
});
