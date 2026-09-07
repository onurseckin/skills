import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  validateGovernanceCharter,
  assertGovernanceCharter,
  resolveGovernanceCharter,
  getCharterGoal,
  hasCharterGoal,
  verifyCharterIntegrity,
  computeCharterSha256,
} from "../../../../olt/scripts/src/mind/governance/charter.ts";
import type { ParsedCharter } from "../../../../olt/scripts/src/mind/governance/charter.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Assembly Init Governance Validation Suite", () => {
  const repoRoot = "/virtual/mind-assembly-repo";
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  const validYaml = `
identity: Governance Overseer
goals:
  - id: G_SEC
    statement: Enforce sandboxed security boundary
  - id: G_PERF
    statement: Guarantee sub-10ms latency
non_goals:
  - Broad disk mutation
repo_roots:
  - src/mind
`;

  const validSha = computeCharterSha256(validYaml);

  const makeCharter = (overrides: Partial<ParsedCharter> = {}): ParsedCharter => ({
    identity: "Governance Overseer",
    goals: [
      { id: "G_SEC", statement: "Enforce sandboxed security boundary" },
      { id: "G_PERF", statement: "Guarantee sub-10ms latency" },
    ],
    goalIds: ["G_SEC", "G_PERF"],
    nonGoals: ["Broad disk mutation"],
    repoRoots: ["src/mind"],
    rawText: validYaml,
    sha256: validSha,
    ...overrides,
  });

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(`${repoRoot}/.git`, { recursive: true });
    vfs.mkdirSync(`${repoRoot}/olt/agents`, { recursive: true });
    vfs.writeFileSync(`${repoRoot}/olt/agents/mind.yaml`, validYaml);
  });

  afterEach(() => {
    session.cleanup();
  });

  it("validateGovernanceCharter validates fully compliant charter and rejects null/non-objects", () => {
    expect(validateGovernanceCharter(makeCharter())).toBe(true);
    expect(validateGovernanceCharter(null as unknown as ParsedCharter)).toBe(false);
    expect(validateGovernanceCharter(undefined as unknown as ParsedCharter)).toBe(false);
    expect(validateGovernanceCharter("string" as unknown as ParsedCharter)).toBe(false);
  });

  it("validateGovernanceCharter rejects missing or empty mandatory sections", () => {
    expect(validateGovernanceCharter(makeCharter({ identity: "" }))).toBe(false);
    expect(validateGovernanceCharter(makeCharter({ identity: "   " }))).toBe(false);
    expect(validateGovernanceCharter(makeCharter({ goals: [] }))).toBe(false);
    expect(validateGovernanceCharter(makeCharter({ goalIds: [] }))).toBe(false);
    expect(validateGovernanceCharter(makeCharter({ nonGoals: [] }))).toBe(false);
    expect(validateGovernanceCharter(makeCharter({ repoRoots: [] }))).toBe(false);
    expect(validateGovernanceCharter(makeCharter({ sha256: "short-sha" }))).toBe(false);
  });

  it("assertGovernanceCharter succeeds on valid charter and throws HarnessError on invalid charter", () => {
    expect(() => assertGovernanceCharter(makeCharter())).not.toThrow();

    const invalid = makeCharter({ goals: [] });
    expect(() => assertGovernanceCharter(invalid)).toThrow(HarnessError);
    try {
      assertGovernanceCharter(invalid);
    } catch (err) {
      expect(err).toBeInstanceOf(HarnessError);
      expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
      expect((err as HarnessError).message).toContain("Governance charter validation failed");
    }
  });

  it("resolveGovernanceCharter loads and validates charter atomically from VirtualMemoryFS", () => {
    const charter = resolveGovernanceCharter(repoRoot);
    expect(charter.identity).toBe("Governance Overseer");
    expect(charter.goalIds).toEqual(["G_SEC", "G_PERF"]);
    expect(charter.repoRoots).toEqual(["src/mind"]);
  });

  it("getCharterGoal and hasCharterGoal retrieve goals case-insensitively with whitespace trimming", () => {
    const charter = makeCharter();
    expect(hasCharterGoal(charter, "g_sec")).toBe(true);
    expect(hasCharterGoal(charter, "  G_PERF  ")).toBe(true);
    expect(hasCharterGoal(charter, "NONEXISTENT")).toBe(false);

    const goal = getCharterGoal(charter, "  g_sec ");
    expect(goal).toBeDefined();
    expect(goal?.id).toBe("G_SEC");
    expect(goal?.statement).toBe("Enforce sandboxed security boundary");
    expect(getCharterGoal(charter, "UNKNOWN")).toBeUndefined();
  });

  it("verifyCharterIntegrity verifies valid SHA-256 and detects corrupted hash in memory", () => {
    const validResult = verifyCharterIntegrity(repoRoot, validSha);
    expect(validResult.valid).toBe(true);
    expect(validResult.actualSha256).toBe(validSha);
    expect(validResult.charterPath).toBe(`${repoRoot}/olt/agents/mind.yaml`);

    const mismatchSha = "0000000000000000000000000000000000000000000000000000000000000000";
    const invalidResult = verifyCharterIntegrity(repoRoot, mismatchSha);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.expectedSha256).toBe(mismatchSha);
  });
});
