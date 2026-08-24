import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const skillRoot = join(import.meta.dir, "..", "..", "..", "olt");

describe("operator reference examples", () => {
  test("the CLI reference delegates to the generated manifest", () => {
    const cli = readFileSync(join(skillRoot, "references", "cli.md"), "utf8");
    expect(cli).toContain("cli-capabilities.md");
    expect(cli).toContain("This file documents no command.");
  });

  test("describes implementer submissions as trusted-host observed evidence", () => {
    const implementer = readFileSync(join(skillRoot, "agents", "implementer.yaml"), "utf8");
    expect(implementer).toContain("trusted-host observed evidence");
    expect(implementer).not.toContain("reproducible evidence");
  });

  test("documents restricted Git execution and versioned path caps without assurance inflation", () => {
    const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
    const protocol = readFileSync(join(skillRoot, "references", "protocol.md"), "utf8");
    const state = readFileSync(join(skillRoot, "references", "state-model.md"), "utf8");
    expect(protocol).toContain("`filter.*.clean`, `filter.*.smudge`, or `filter.*.process`");
    expect(protocol).toContain("local `diff.external`, every `diff.*.textconv`");
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

  test("the Diataxis reference hub exists under docs/olt/reference/", () => {
    const refDir = join(import.meta.dir, "..", "..", "..", "docs", "olt", "reference");
    expect(existsSync(join(refDir, "harness-cli.md"))).toBe(true);
    expect(existsSync(join(refDir, "state-schemas.md"))).toBe(true);
    expect(existsSync(join(refDir, "error-codes.md"))).toBe(true);
    expect(existsSync(join(refDir, "role-contracts.md"))).toBe(true);
    expect(existsSync(join(refDir, "verification-engines.md"))).toBe(true);
  });
});
