import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

const skillRoot = "/virtual/skill-root";
const refDir = "/virtual/docs/olt/reference";

let vfs: VirtualMemoryFS;

beforeEach(() => {
  vfs = new VirtualMemoryFS();

  vfs.mkdirSync(join(skillRoot, "references"), { recursive: true });
  vfs.writeFileSync(
    join(skillRoot, "references", "cli.md"),
    "# CLI Reference\n\nSee cli-capabilities.md for details.\nThis file documents no command.\n",
  );

  vfs.mkdirSync(join(skillRoot, "agents"), { recursive: true });
  vfs.writeFileSync(
    join(skillRoot, "agents", "implementer.yaml"),
    "role: implementer\nevidence: trusted-host observed evidence\n",
  );

  vfs.writeFileSync(
    join(skillRoot, "SKILL.md"),
    "# SKILL\n\nAssurance: trusted_host_observed_v1\n",
  );

  vfs.writeFileSync(
    join(skillRoot, "references", "protocol.md"),
    `# Protocol Reference
Configuration forbids \`filter.*.clean\`, \`filter.*.smudge\`, or \`filter.*.process\`.
Disallows local \`diff.external\`, every \`diff.*.textconv\`.
Ensures declared Git gate argv and fingerprint remain unchanged.
Declared Git and wrapper executable names must be bare.
Tracks persisted \`execution_argv\`.
Enforces \`GIT_NO_REPLACE_OBJECTS=1\`.
Indexed gitlinks are rejected before porcelain status.
Any invalid command is rejected before command intent publication or process spawn.
Assurance model: trusted_host_observed_v1.
`,
  );

  vfs.writeFileSync(
    join(skillRoot, "references", "state-model.md"),
    `# State Model
Governed by \`harness.repository-content-scan-policy\` version 1.
Non-regular, non-symlink leaves are rejected before open.
It deliberately does not recursively traverse objects, refs, or the.
Applies only to the spawned Git child, never a process group, ancestor.
Assurance: trusted_host_observed_v1.
`,
  );

  vfs.mkdirSync(refDir, { recursive: true });
  vfs.writeFileSync(join(refDir, "index.md"), "# Reference Hub Index\n");
  vfs.writeFileSync(join(refDir, "quickstart.md"), "# Quickstart\n");
  vfs.writeFileSync(join(refDir, "health-and-status.md"), "# Health and Status\n");
});

afterEach(() => {
  vfs.reset();
});

describe("operator reference examples", () => {
  test("the CLI reference delegates to the generated manifest", () => {
    const cli = vfs.readFileSync(join(skillRoot, "references", "cli.md"), { encoding: "utf8" });
    expect(cli).toContain("cli-capabilities.md");
    expect(cli).toContain("This file documents no command.");
  });

  test("describes implementer submissions as trusted-host observed evidence", () => {
    const implementer = vfs.readFileSync(join(skillRoot, "agents", "implementer.yaml"), { encoding: "utf8" });
    expect(implementer).toContain("trusted-host observed evidence");
    expect(implementer).not.toContain("reproducible evidence");
  });

  test("documents restricted Git execution and versioned path caps without assurance inflation", () => {
    const skill = vfs.readFileSync(join(skillRoot, "SKILL.md"), { encoding: "utf8" });
    const protocol = vfs.readFileSync(join(skillRoot, "references", "protocol.md"), { encoding: "utf8" });
    const state = vfs.readFileSync(join(skillRoot, "references", "state-model.md"), { encoding: "utf8" });
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
    expect(vfs.existsSync(join(refDir, "index.md"))).toBe(true);
    expect(vfs.existsSync(join(refDir, "quickstart.md"))).toBe(true);
    expect(vfs.existsSync(join(refDir, "health-and-status.md"))).toBe(true);
  });
});
