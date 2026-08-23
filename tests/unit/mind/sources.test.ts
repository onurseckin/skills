import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import {
  formatMindObserveBrief,
  mindObserveCommand,
} from "../../../olt/scripts/src/cli/commands/mind-observe.ts";
import { COMMAND_REGISTRY, findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import {
  findSourceDefinition,
  getSourceDefinition,
  isMindSourceId,
  MIND_DISCOVERY_SOURCES,
  resolveCommandRecord,
  resolveSourceToRegistryCommand,
  validateQuiescentSources,
  type EvidenceClass,
  type MindSourceId,
} from "../../../olt/scripts/src/mind/sources.ts";
import { initRun } from "../../../olt/scripts/src/store/capsule.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/store/integrity.ts";
import { loadRun } from "../../../olt/scripts/src/store/load.ts";
import { transact } from "../../../olt/scripts/src/store/transaction.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempRoots.length = 0;
});

interface MindTestCapsule {
  readonly repo: string;
  readonly capsulesDir: string;
  readonly mindRun: string;
  readonly otherRun: string;
}

function setupMindCapsuleEnvironment(name: string): MindTestCapsule {
  const repo = mkdtempSync(join(tmpdir(), `mind-sources-test-${name}-`));
  tempRoots.push(repo);

  const capsulesDir = join(repo, ".capsules");
  mkdirSync(capsulesDir, { recursive: true });

  const charterDir = join(repo, "docs", "mind");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent = `# CHARTER\n\n## identity\nDiscovery source test app\n\n## goals\n- G1: Stability\n\n## non-goals\n- None\n\n## repo_roots\n- \`src/\`\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const mindRun = initRun(repo, `mind-gen-${name}`, charterBytes, "file", true);

  transact(
    mindRun,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "docs/mind/CHARTER.md",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "docs/mind/CHARTER.md",
          pinned_sha256: charterSha,
          goals: ["G1"],
          repo_roots: ["src/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      };
      working.budget = {
        pulses_per_day: 96,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 3,
        base_interval_ms: 900_000,
        max_interval_ms: 14_400_000,
        max_pause_interval_ms: 1_800_000,
        pulse_deadline_ms: 1_200_000,
        max_open_proposals: 5,
        quiet_hours: null,
        day_key: "2026-08-21",
        pulses_today: 0,
        wall_clock_ms_today: 0,
      };
      working.pulse = {
        counter: 1,
        open: {
          pulse_id: "pulse-1",
          opened_at: new Date().toISOString(),
          deadline_at: new Date(Date.now() + 1_200_000).toISOString(),
          actor: "mind-1",
          host: "antigravity",
          driver: "pulse.sh",
        },
        last: null,
      };
      working.observations = [];
      working.candidates = [];
      working.escalations = [];
    },
  );

  agentRegisterCommand({
    run: mindRun,
    agent: "mind-1",
    role: "mind",
    host: "antigravity",
  });

  // Also create a separate execution run capsule for cross-capsule command evidence
  const otherPrompt = Buffer.from("Execution run prompt");
  const otherRun = initRun(repo, `exec-run-${name}`, otherPrompt, "file", true);

  return { repo, capsulesDir, mindRun, otherRun };
}

describe("The 10 Authoritative Discovery Sources (PLAN.md §7.2 / PHASE-3.md §3.2)", () => {
  test("defines exactly 10 authoritative sources", () => {
    expect(MIND_DISCOVERY_SOURCES.length).toBe(10);
  });

  test("each source has distinct numbers 1 through 10", () => {
    const numbers = MIND_DISCOVERY_SOURCES.map((s) => s.number);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("every source maps to a real command in COMMAND_REGISTRY", () => {
    const registryInvocations = new Set(COMMAND_REGISTRY.map((c) => c.name));
    for (const source of MIND_DISCOVERY_SOURCES) {
      expect(registryInvocations.has(source.registryCommand)).toBe(true);
      const spec = findCommand(source.registryCommand);
      expect(spec).toBeDefined();
      expect(spec?.name).toBe(source.registryCommand);

      const resolved = resolveSourceToRegistryCommand(source.id);
      expect(resolved.name).toBe(source.registryCommand);
    }
  });

  test("each source specifies accurate metadata matching PLAN.md §7.2 specifications", () => {
    const expectedSources: {
      readonly id: MindSourceId;
      readonly number: number;
      readonly registryCommand: string;
      readonly evidenceClass: EvidenceClass;
    }[] = [
      {
        id: "intent-drift",
        number: 1,
        registryCommand: "health",
        evidenceClass: "harness_observed",
      },
      {
        id: "unused-code",
        number: 2,
        registryCommand: "health",
        evidenceClass: "harness_observed",
      },
      {
        id: "literal-fallbacks",
        number: 3,
        registryCommand: "health",
        evidenceClass: "harness_observed",
      },
      {
        id: "open-findings",
        number: 4,
        registryCommand: "finding:get",
        evidenceClass: "agent_reported",
      },
      {
        id: "escalated-tasks",
        number: 5,
        registryCommand: "run:status",
        evidenceClass: "harness_observed",
      },
      {
        id: "failing-gates",
        number: 6,
        registryCommand: "evidence:get",
        evidenceClass: "harness_observed",
      },
      {
        id: "capsule-integrity",
        number: 7,
        registryCommand: "doctor",
        evidenceClass: "harness_observed",
      },
      {
        id: "install-drift",
        number: 8,
        registryCommand: "installation-status",
        evidenceClass: "harness_observed",
      },
      {
        id: "unsealed-capsules",
        number: 9,
        registryCommand: "run:status",
        evidenceClass: "harness_observed",
      },
      {
        id: "charter-backlog",
        number: 10,
        registryCommand: "health",
        evidenceClass: "harness_observed",
      },
    ];

    for (const expected of expectedSources) {
      const source = getSourceDefinition(expected.id);
      expect(source.number).toBe(expected.number);
      expect(source.registryCommand).toBe(expected.registryCommand);
      expect(source.evidenceClass).toBe(expected.evidenceClass);
      expect(isMindSourceId(expected.id)).toBe(true);
    }
  });

  test("supports alias lookup for discovery sources", () => {
    expect(findSourceDefinition("intent_drift")?.id).toBe("intent-drift");
    expect(findSourceDefinition("dead-code")?.id).toBe("unused-code");
    expect(findSourceDefinition("dead_code")?.id).toBe("unused-code");
    expect(findSourceDefinition("unenforced")?.id).toBe("unused-code");
    expect(findSourceDefinition("literal_fallbacks")?.id).toBe("literal-fallbacks");
    expect(findSourceDefinition("validator-findings")?.id).toBe("open-findings");
    expect(findSourceDefinition("findings")?.id).toBe("open-findings");
    expect(findSourceDefinition("escalations")?.id).toBe("escalated-tasks");
    expect(findSourceDefinition("needs-human")?.id).toBe("escalated-tasks");
    expect(findSourceDefinition("failingGateRuns")?.id).toBe("failing-gates");
    expect(findSourceDefinition("doctor")?.id).toBe("capsule-integrity");
    expect(findSourceDefinition("runtime-drift")?.id).toBe("install-drift");
    expect(findSourceDefinition("live-leases")?.id).toBe("unsealed-capsules");
    expect(findSourceDefinition("owner-backlog")?.id).toBe("charter-backlog");
  });

  test("findSourceDefinition and getSourceDefinition handle unknown sources", () => {
    expect(findSourceDefinition("unknown-source")).toBeUndefined();
    expect(findSourceDefinition("")).toBeUndefined();
    expect(isMindSourceId("unknown-source")).toBe(false);

    expect(() => getSourceDefinition("non-existent-source")).toThrow(HarnessError);
    try {
      getSourceDefinition("non-existent-source");
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_ARGUMENT");
      expect(harnessErr.message).toContain("unknown discovery source 'non-existent-source'");
    }
  });
});

describe("Command Evidence Resolution (resolveCommandRecord)", () => {
  test("resolves command record from commands/<id>/record.json in current capsule", () => {
    const { mindRun } = setupMindCapsuleEnvironment("cmd-res-direct");
    const cmdDir = join(mindRun, "commands", "C-cmd-001");
    mkdirSync(cmdDir, { recursive: true });
    const recordPath = join(cmdDir, "record.json");
    writeFileSync(
      recordPath,
      JSON.stringify({
        id: "C-cmd-001",
        argv: ["bun", "test"],
        exit_code: 0,
      }),
      "utf-8",
    );

    const res = resolveCommandRecord("C-cmd-001", { runRoot: mindRun });
    expect(res.found).toBe(true);
    expect(res.commandId).toBe("C-cmd-001");
    expect(res.location).toBe(recordPath);
    expect(res.record?.id).toBe("C-cmd-001");
  });

  test("resolves command record from commands/<id>.json in current capsule", () => {
    const { mindRun } = setupMindCapsuleEnvironment("cmd-res-json");
    const cmdDir = join(mindRun, "commands");
    mkdirSync(cmdDir, { recursive: true });
    const jsonPath = join(cmdDir, "cmd-flat-002.json");
    writeFileSync(
      jsonPath,
      JSON.stringify({
        id: "cmd-flat-002",
        status: "succeeded",
      }),
      "utf-8",
    );

    const res = resolveCommandRecord("cmd-flat-002", { runRoot: mindRun });
    expect(res.found).toBe(true);
    expect(res.commandId).toBe("cmd-flat-002");
    expect(res.location).toBe(jsonPath);
  });

  test("resolves command record from sibling capsule in .capsules directory", () => {
    const { repo, mindRun, otherRun } = setupMindCapsuleEnvironment("cmd-res-sibling");
    const cmdDir = join(otherRun, "commands", "C-sibling-003");
    mkdirSync(cmdDir, { recursive: true });
    const recordPath = join(cmdDir, "record.json");
    writeFileSync(
      recordPath,
      JSON.stringify({
        id: "C-sibling-003",
        status: "failed",
        exit_code: 1,
      }),
      "utf-8",
    );

    const res = resolveCommandRecord("C-sibling-003", {
      runRoot: mindRun,
      repoRoot: repo,
    });
    expect(res.found).toBe(true);
    expect(res.commandId).toBe("C-sibling-003");
    expect(res.location).toBe(recordPath);
    expect(res.runRoot).toBe(otherRun);
  });

  test("resolves command record recorded inside capsule state.json commands object", () => {
    const { mindRun } = setupMindCapsuleEnvironment("cmd-res-state");
    transact(mindRun, "mind-1", "test-command-recorded", {}, (working) => {
      working.commands = {
        "cmd-in-state-004": {
          id: "cmd-in-state-004",
          argv: ["bun", "run", "typecheck"],
          status: "succeeded",
        },
      };
    });

    const res = resolveCommandRecord("cmd-in-state-004", { runRoot: mindRun });
    expect(res.found).toBe(true);
    expect(res.commandId).toBe("cmd-in-state-004");
    expect(res.record?.id).toBe("cmd-in-state-004");
  });

  test("returns found: false when command is not found anywhere", () => {
    const { mindRun } = setupMindCapsuleEnvironment("cmd-not-found");
    const res = resolveCommandRecord("non-existent-cmd-999", { runRoot: mindRun });
    expect(res.found).toBe(false);
    expect(res.commandId).toBe("non-existent-cmd-999");
  });

  test("returns found: false for empty or blank command IDs", () => {
    expect(resolveCommandRecord("").found).toBe(false);
    expect(resolveCommandRecord("   ").found).toBe(false);
  });
});

describe("mindObserveCommand", () => {
  test("successfully records a source observation evidenced by a real recorded command", () => {
    const { mindRun } = setupMindCapsuleEnvironment("observe-happy");
    const cmdDir = join(mindRun, "commands", "cmd-drift-101");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(
      join(cmdDir, "record.json"),
      JSON.stringify({ id: "cmd-drift-101", status: "failed", exit_code: 1 }),
      "utf-8",
    );

    const nowIso = "2026-08-21T05:30:00.000Z";
    const result = mindObserveCommand({
      run: mindRun,
      actor: "mind-1",
      source: "intent-drift",
      "command-id": "cmd-drift-101",
      count: "14",
      now: nowIso,
    });

    expect(result.run_root).toBe(mindRun);
    expect(result.actor).toBe("mind-1");
    expect(result.observation_id).toBe("obs-1");
    expect(result.source).toBe("intent-drift");
    expect(result.source_number).toBe(1);
    expect(result.command_id).toBe("cmd-drift-101");
    expect(result.count).toBe(14);
    expect(result.evidence_class).toBe("harness_observed");
    expect(result.observed_at).toBe(nowIso);

    // Verify state projection has observation appended
    const loaded = loadRun(mindRun, false);
    const observations = loaded.state.observations as Record<string, unknown>[];
    expect(Array.isArray(observations)).toBe(true);
    expect(observations.length).toBe(1);
    expect(observations[0]?.id).toBe("obs-1");
    expect(observations[0]?.source).toBe("intent-drift");
    expect(observations[0]?.command_id).toBe("cmd-drift-101");
    expect(observations[0]?.count).toBe(14);
    expect(observations[0]?.evidence_class).toBe("harness_observed");
    expect(observations[0]?.observed_at).toBe(nowIso);

    // Verify hash chain integrity
    const integrity = verifyIntegrity(mindRun);
    expect(integrity.length).toBe(0);

    // Second observation increments observation id
    const result2 = mindObserveCommand({
      run: mindRun,
      actor: "mind-1",
      source: "unused-code",
      "command-id": "cmd-drift-101",
      count: "0",
      now: nowIso,
    });
    expect(result2.observation_id).toBe("obs-2");
    expect(result2.source).toBe("unused-code");
    expect(result2.source_number).toBe(2);

    const loaded2 = loadRun(mindRun, false);
    expect((loaded2.state.observations as unknown[]).length).toBe(2);
  });

  test("resolves command evidence from cross-capsule run in .capsules", () => {
    const { mindRun, otherRun } = setupMindCapsuleEnvironment("cross-cap-observe");
    const cmdDir = join(otherRun, "commands", "C-val-finding-77");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(
      join(cmdDir, "record.json"),
      JSON.stringify({ id: "C-val-finding-77", status: "succeeded", exit_code: 0 }),
      "utf-8",
    );

    const result = mindObserveCommand({
      run: mindRun,
      actor: "mind-1",
      source: "open-findings",
      "command-id": "C-val-finding-77",
      count: "2",
    });

    expect(result.source).toBe("open-findings");
    expect(result.evidence_class).toBe("agent_reported");
    expect(result.command_id).toBe("C-val-finding-77");
  });

  test("refuses unknown source id and leaves event sequence unchanged", () => {
    const { mindRun } = setupMindCapsuleEnvironment("unknown-source");
    const seqBefore = loadRun(mindRun, false).state.event_sequence;

    expect(() => {
      mindObserveCommand({
        run: mindRun,
        actor: "mind-1",
        source: "my-made-up-source",
        "command-id": "cmd-1",
        count: "0",
      });
    }).toThrow(HarnessError);

    try {
      mindObserveCommand({
        run: mindRun,
        actor: "mind-1",
        source: "my-made-up-source",
        "command-id": "cmd-1",
        count: "0",
      });
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_ARGUMENT");
      expect(harnessErr.message).toContain("unknown discovery source 'my-made-up-source'");
      expect(harnessErr.message).toContain("intent-drift");
    }

    expect(loadRun(mindRun, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when --command-id is missing or resolves to no recorded command in .capsules", () => {
    const { mindRun } = setupMindCapsuleEnvironment("missing-cmd-evidence");
    const seqBefore = loadRun(mindRun, false).state.event_sequence;

    try {
      mindObserveCommand({
        run: mindRun,
        actor: "mind-1",
        source: "intent-drift",
        "command-id": "non-existent-cmd-id-404",
        count: "0",
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_ARGUMENT");
      expect(harnessErr.message).toContain("non-existent-cmd-id-404");
      expect(harnessErr.message).toContain("was not found in any capsule under .capsules");
    }

    expect(loadRun(mindRun, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when --command-id flag is empty string", () => {
    const { mindRun } = setupMindCapsuleEnvironment("empty-cmd-flag");
    expect(() => {
      mindObserveCommand({
        run: mindRun,
        actor: "mind-1",
        source: "intent-drift",
        "command-id": "",
        count: "0",
      });
    }).toThrow(HarnessError);
  });

  test("refuses negative or invalid count", () => {
    const { mindRun } = setupMindCapsuleEnvironment("negative-count");
    const cmdDir = join(mindRun, "commands", "cmd-ok");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(cmdDir, "record.json"), JSON.stringify({ id: "cmd-ok" }), "utf-8");

    expect(() => {
      mindObserveCommand({
        run: mindRun,
        actor: "mind-1",
        source: "intent-drift",
        "command-id": "cmd-ok",
        count: "-1",
      });
    }).toThrow(HarnessError);
  });

  test("refuses unregistered actor or actor without role 'mind'", () => {
    const { mindRun } = setupMindCapsuleEnvironment("role-enforce");
    const cmdDir = join(mindRun, "commands", "cmd-ok");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(cmdDir, "record.json"), JSON.stringify({ id: "cmd-ok" }), "utf-8");

    // 1. Unregistered agent
    try {
      mindObserveCommand({
        run: mindRun,
        actor: "unregistered-agent",
        source: "intent-drift",
        "command-id": "cmd-ok",
        count: "0",
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("holds no grant");
    }

    // 2. Agent registered with wrong role
    agentRegisterCommand({
      run: mindRun,
      agent: "worker-1",
      role: "implementer",
      host: "antigravity",
    });

    try {
      mindObserveCommand({
        run: mindRun,
        actor: "worker-1",
        source: "intent-drift",
        "command-id": "cmd-ok",
        count: "0",
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("role 'mind' is required");
    }
  });

  test("formatMindObserveBrief renders clean markdown adhering to line limit", () => {
    const md = formatMindObserveBrief({
      observationId: "obs-1",
      runRoot: ".capsules/mind-gen-1",
      actor: "mind-1",
      sourceId: "intent-drift",
      sourceNumber: 1,
      sourceName: "code no longer matching intent",
      commandId: "cmd-101",
      count: 0,
      evidenceClass: "harness_observed",
      observedAt: "2026-08-21T05:00:00.000Z",
    });

    expect(md).toContain("### Mind Source Observed: intent-drift (obs-1)");
    expect(md).toContain("- **Capsule Root**: `.capsules/mind-gen-1`");
    expect(md).toContain("- **Actor**: `mind-1`");
    expect(md).toContain("- **Source**: `intent-drift` (#1 — code no longer matching intent)");
    expect(md).toContain("- **Command ID**: `cmd-101`");
    expect(md).toContain("- **Count**: 0");
    expect(md).toContain("- **Evidence Class**: `harness_observed`");
    expect(md.split("\n").length).toBeLessThanOrEqual(30);
  });
});

describe("Precondition for Quiescence: Observing all 10 sources with zero counts", () => {
  test("validateQuiescentSources passes when all ten sources have count: 0", () => {
    const allCleanObservations: { source: MindSourceId; count: number }[] = [
      { source: "intent-drift", count: 0 },
      { source: "unused-code", count: 0 },
      { source: "literal-fallbacks", count: 0 },
      { source: "open-findings", count: 0 },
      { source: "escalated-tasks", count: 0 },
      { source: "failing-gates", count: 0 },
      { source: "capsule-integrity", count: 0 },
      { source: "install-drift", count: 0 },
      { source: "unsealed-capsules", count: 0 },
      { source: "charter-backlog", count: 0 },
    ];

    const check = validateQuiescentSources(allCleanObservations);
    expect(check.ok).toBe(true);
    expect(check.missingSources.length).toBe(0);
    expect(check.nonZeroSources.length).toBe(0);
    expect(check.invalidSources.length).toBe(0);
  });

  test("validateQuiescentSources accepts alias names for sources", () => {
    const aliasObservations = [
      { source: "intent_drift", count: 0 },
      { source: "dead-code", count: 0 },
      { source: "literal_fallbacks", count: 0 },
      { source: "findings", count: 0 },
      { source: "needs-human", count: 0 },
      { source: "failingGateRuns", count: 0 },
      { source: "doctor", count: 0 },
      { source: "runtime-drift", count: 0 },
      { source: "live-leases", count: 0 },
      { source: "owner-backlog", count: 0 },
    ];

    const check = validateQuiescentSources(aliasObservations);
    expect(check.ok).toBe(true);
    expect(check.missingSources.length).toBe(0);
  });

  test("validateQuiescentSources refuses when fewer than 10 sources are observed", () => {
    const partialObservations: { source: MindSourceId; count: number }[] = [
      { source: "intent-drift", count: 0 },
      { source: "unused-code", count: 0 },
      { source: "literal-fallbacks", count: 0 },
      { source: "open-findings", count: 0 },
      { source: "escalated-tasks", count: 0 },
      { source: "failing-gates", count: 0 },
      { source: "capsule-integrity", count: 0 },
      { source: "install-drift", count: 0 },
      { source: "unsealed-capsules", count: 0 },
      // charter-backlog missing (9 of 10)
    ];

    const check = validateQuiescentSources(partialObservations);
    expect(check.ok).toBe(false);
    expect(check.missingSources).toEqual(["charter-backlog"]);
    expect(check.reason).toContain("missing 1 of 10 sources: charter-backlog");
  });

  test("validateQuiescentSources refuses when any source has non-zero count", () => {
    const nonZeroObservations: { source: MindSourceId; count: number }[] = [
      { source: "intent-drift", count: 3 }, // non-zero!
      { source: "unused-code", count: 0 },
      { source: "literal-fallbacks", count: 0 },
      { source: "open-findings", count: 1 }, // non-zero!
      { source: "escalated-tasks", count: 0 },
      { source: "failing-gates", count: 0 },
      { source: "capsule-integrity", count: 0 },
      { source: "install-drift", count: 0 },
      { source: "unsealed-capsules", count: 0 },
      { source: "charter-backlog", count: 0 },
    ];

    const check = validateQuiescentSources(nonZeroObservations);
    expect(check.ok).toBe(false);
    expect(check.nonZeroSources.length).toBe(2);
    expect(check.nonZeroSources).toEqual([
      { source: "intent-drift", count: 3 },
      { source: "open-findings", count: 1 },
    ]);
    expect(check.reason).toContain("non-zero counts in sources");
  });

  test("validateQuiescentSources refuses unknown/invalid source names", () => {
    const invalidList = [
      { source: "intent-drift", count: 0 },
      { source: "bogus-source", count: 0 },
    ];

    const check = validateQuiescentSources(invalidList);
    expect(check.ok).toBe(false);
    expect(check.invalidSources).toEqual(["bogus-source"]);
    expect(check.reason).toContain("invalid source IDs: bogus-source");
  });
});
