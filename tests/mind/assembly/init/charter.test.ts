import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  normalizeCharterContent,
  computeCharterSha256,
  resolveCharterPath,
  loadCharter,
  formatCharterSummary,
} from "../../../../olt/scripts/src/mind/governance/charter.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Assembly Init Charter Lifecycle Suite", () => {
  const repoRoot = "/virtual/mind-assembly-repo";
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  const validYaml = `
identity: Mind Assembly Init Agent
goals:
  - id: G_INIT
    statement: Bootstrap autonomous runtime
  - id: G_GOV
    statement: Enforce governance policies
non_goals:
  - Manual unreviewed modifications
repo_roots:
  - src
  - packages
stability:
  - command: bun test
    expectedExit: 0
budgets:
  max_agents_in_flight: 3
prohibitions:
  - Never push unverified changes
`;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(`${repoRoot}/.git`, { recursive: true });
    vfs.mkdirSync(`${repoRoot}/olt/scripts`, { recursive: true });
    vfs.writeFileSync(`${repoRoot}/olt/scripts/harness.ts`, "");
    vfs.mkdirSync(`${repoRoot}/olt/agents`, { recursive: true });
    vfs.writeFileSync(`${repoRoot}/olt/agents/mind.yaml`, validYaml);
  });

  afterEach(() => {
    session.cleanup();
  });

  it("normalizeCharterContent converts CRLF and CR to standard LF newlines", () => {
    const raw = "identity: test\r\ngoals:\r\n  - G1\rstatus: ok\n";
    const normalized = normalizeCharterContent(raw);
    expect(normalized).toBe("identity: test\ngoals:\n  - G1\nstatus: ok\n");
    expect(normalized).not.toContain("\r");
  });

  it("computeCharterSha256 generates deterministic 64-character SHA-256 hash", () => {
    const hash1 = computeCharterSha256(validYaml);
    const hash2 = computeCharterSha256(validYaml.replace(/\n/g, "\r\n"));
    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    expect(hash1).toBe(hash2);
  });

  it("resolveCharterPath resolves default canonical path, custom path, and fallback when missing", () => {
    const resolvedDefault = resolveCharterPath(repoRoot);
    expect(resolvedDefault).toBe(`${repoRoot}/olt/agents/mind.yaml`);

    vfs.writeFileSync(`${repoRoot}/custom-charter.yaml`, validYaml);
    const resolvedCustom = resolveCharterPath(repoRoot, "custom-charter.yaml");
    expect(resolvedCustom).toBe(`${repoRoot}/custom-charter.yaml`);

    const fallback = resolveCharterPath(repoRoot, "nonexistent-charter.yaml");
    expect(fallback).toBe(`${repoRoot}/nonexistent-charter.yaml`);
  });

  it("loadCharter successfully loads and parses YAML charter from VirtualMemoryFS", () => {
    const charter = loadCharter(repoRoot);
    expect(charter.identity).toBe("Mind Assembly Init Agent");
    expect(charter.goalIds).toEqual(["G_INIT", "G_GOV"]);
    expect(charter.goals).toHaveLength(2);
    expect(charter.goals[0]).toEqual({
      id: "G_INIT",
      statement: "Bootstrap autonomous runtime",
    });
    expect(charter.nonGoals).toEqual(["Manual unreviewed modifications"]);
    expect(charter.repoRoots).toEqual(["src", "packages"]);
    expect(charter.sha256).toHaveLength(64);
  });

  it("loadCharter throws HarnessError INVALID_ARGUMENT when charter file does not exist", () => {
    expect(() => loadCharter(repoRoot, "missing.yaml")).toThrow(HarnessError);
    try {
      loadCharter(repoRoot, "missing.yaml");
    } catch (err) {
      expect(err).toBeInstanceOf(HarnessError);
      expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
      expect((err as HarnessError).message).toContain("does not exist");
    }
  });

  it("loadCharter throws HarnessError INVALID_ARGUMENT when YAML content is malformed or not an object", () => {
    vfs.writeFileSync(`${repoRoot}/empty.yaml`, "   \n");
    expect(() => loadCharter(repoRoot, "empty.yaml")).toThrow(HarnessError);

    vfs.writeFileSync(`${repoRoot}/scalar.yaml`, "just a plain string");
    expect(() => loadCharter(repoRoot, "scalar.yaml")).toThrow(HarnessError);
  });

  it("formatCharterSummary formats identity, goals, and repoRoots string representation", () => {
    const charter = loadCharter(repoRoot);
    const summary = formatCharterSummary(charter);
    expect(summary).toContain("Identity: Mind Assembly Init Agent");
    expect(summary).toContain(
      "Goals (2): [G_INIT: Bootstrap autonomous runtime; G_GOV: Enforce governance policies]",
    );
    expect(summary).toContain("Repo Roots: [src, packages]");
  });

  describe("consumer repo isolation", () => {
    const consumerRoot = "/virtual/mind-assembly-consumer-repo";

    it("never resolves an unhidden olt/agents/mind.yaml for a bare consumer repo root", () => {
      vfs.mkdirSync(`${consumerRoot}/olt/agents`, { recursive: true });
      vfs.writeFileSync(`${consumerRoot}/olt/agents/mind.yaml`, validYaml);

      const resolved = resolveCharterPath(consumerRoot);
      expect(resolved).not.toBe(`${consumerRoot}/olt/agents/mind.yaml`);
      expect(resolved).toBe(`${consumerRoot}/.olt/mind.yaml`);

      expect(() => loadCharter(consumerRoot)).toThrow(HarnessError);
    });
  });
});
