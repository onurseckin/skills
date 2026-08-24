import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import {
  formatMindQuiesceBrief,
  mindQuiesceCommand,
} from "../../../olt/scripts/src/cli/commands/mind-quiesce.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  buildQuiescentDigest,
  calculateQuiescentInterval,
  computeQuiescentStreak,
  parseQuiescentSourceSpec,
  shouldTriggerQuiescentDigest,
  tryParseQuiescentSourceSpec,
  validateQuiescentScan,
  type QuiescentSourceObservation,
} from "../../../olt/scripts/src/mind/quiesce.ts";
import { MIND_DISCOVERY_SOURCES } from "../../../olt/scripts/src/mind/sources.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/engine/store/integrity.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";

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

interface MindTestFixture {
  readonly repo: string;
  readonly capsulesDir: string;
  readonly mindRun: string;
  readonly commandIds: readonly string[];
}

function setupMindFixture(
  name: string,
  options: {
    readonly quiescentStreak?: number;
    readonly baseIntervalMs?: number;
    readonly maxIntervalMs?: number;
  } = {},
): MindTestFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-quiesce-test-${name}-`));
  tempRoots.push(repo);

  const capsulesDir = join(repo, ".olt", "capsules");
  mkdirSync(capsulesDir, { recursive: true });

  const charterDir = join(repo, "docs");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent = `# CHARTER\n\n## identity\nQuiesce Test App\n\n## goals\n- G1: Stability\n\n## non-goals\n- None\n\n## repo_roots\n- \`src/\`\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const mindRun = initRun(repo, `mind-gen-${name}`, charterBytes, "file", true);

  // Setup recorded command files for evidence
  const commandIds: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const cmdId = `cmd-obs-${i}`;
    commandIds.push(cmdId);
    const cmdDir = join(mindRun, "commands", cmdId);
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(
      join(cmdDir, "record.json"),
      JSON.stringify({
        command_id: cmdId,
        argv: ["health", "--check", "all"],
        exit_code: 0,
        recorded_at: new Date().toISOString(),
      }),
      "utf-8",
    );
  }

  transact(
    mindRun,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "docs/CHARTER.md",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "docs/CHARTER.md",
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
        base_interval_ms: options.baseIntervalMs ?? 900_000,
        max_interval_ms: options.maxIntervalMs ?? 14_400_000,
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
        quiescent_streak: options.quiescentStreak ?? 0,
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

  return { repo, capsulesDir, mindRun, commandIds };
}

function buildValid10SourceFlags(commandIds: readonly string[]): readonly string[] {
  return MIND_DISCOVERY_SOURCES.map((s, idx) => `${s.id}:${commandIds[idx]}:0`);
}

describe("Quiesce Module: Specifications & Pure Functions", () => {
  test("parseQuiescentSourceSpec parses valid <source>:<command-id>:<count>", () => {
    const parsed = parseQuiescentSourceSpec("intent-drift:cmd-123:0");
    expect(parsed.source).toBe("intent-drift");
    expect(parsed.commandId).toBe("cmd-123");
    expect(parsed.count).toBe(0);
  });

  test("parseQuiescentSourceSpec handles command IDs with colons", () => {
    const parsed = parseQuiescentSourceSpec("unused-code:urn:exec:cmd-456:0");
    expect(parsed.source).toBe("unused-code");
    expect(parsed.commandId).toBe("urn:exec:cmd-456");
    expect(parsed.count).toBe(0);
  });

  test("parseQuiescentSourceSpec throws HarnessError on malformed specs", () => {
    expect(() => parseQuiescentSourceSpec("")).toThrow(HarnessError);
    expect(() => parseQuiescentSourceSpec("intent-drift")).toThrow(HarnessError);
    expect(() => parseQuiescentSourceSpec("intent-drift:0")).toThrow(HarnessError);
    expect(() => parseQuiescentSourceSpec("intent-drift::0")).toThrow(HarnessError);
    expect(() => parseQuiescentSourceSpec(":cmd-1:0")).toThrow(HarnessError);
    expect(() => parseQuiescentSourceSpec("intent-drift:cmd-1:abc")).toThrow(HarnessError);
    expect(() => parseQuiescentSourceSpec("intent-drift:cmd-1:-5")).toThrow(HarnessError);
    expect(() => parseQuiescentSourceSpec("intent-drift:cmd-1:3.14")).toThrow(HarnessError);
  });

  test("tryParseQuiescentSourceSpec returns ok/error result safely", () => {
    const okRes = tryParseQuiescentSourceSpec("intent-drift:cmd-1:0");
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.value.source).toBe("intent-drift");
      expect(okRes.value.commandId).toBe("cmd-1");
      expect(okRes.value.count).toBe(0);
    }

    const errRes = tryParseQuiescentSourceSpec("invalid-spec");
    expect(errRes.ok).toBe(false);
    if (!errRes.ok) {
      expect(errRes.error).toContain("invalid source spec");
    }
  });

  test("computeQuiescentStreak increments previous streak or starts at 1", () => {
    expect(computeQuiescentStreak(undefined)).toBe(1);
    expect(computeQuiescentStreak(null)).toBe(1);
    expect(computeQuiescentStreak(0)).toBe(1);
    expect(computeQuiescentStreak(1)).toBe(2);
    expect(computeQuiescentStreak(7)).toBe(8);
    expect(computeQuiescentStreak(8)).toBe(9);
  });

  test("calculateQuiescentInterval computes 1.5x exponential backoff capped at max_interval", () => {
    const base = 900_000; // 15m
    const max = 14_400_000; // 4h

    expect(calculateQuiescentInterval(base, max, 0)).toBe(900_000);
    expect(calculateQuiescentInterval(base, max, 1)).toBe(1_350_000); // 15m * 1.5 = 22.5m
    expect(calculateQuiescentInterval(base, max, 2)).toBe(2_025_000); // 15m * 2.25 = 33.75m
    expect(calculateQuiescentInterval(base, max, 3)).toBe(3_037_500); // 15m * 3.375
    expect(calculateQuiescentInterval(base, max, 4)).toBe(4_556_250);
    expect(calculateQuiescentInterval(base, max, 5)).toBe(6_834_375);
    expect(calculateQuiescentInterval(base, max, 6)).toBe(10_251_563);
    // At streak 7: 900_000 * 1.5^7 = 15_377_344 -> capped at 14_400_000
    expect(calculateQuiescentInterval(base, max, 7)).toBe(14_400_000);
    expect(calculateQuiescentInterval(base, max, 8)).toBe(14_400_000);
    expect(calculateQuiescentInterval(base, max, 50)).toBe(14_400_000);
  });

  test("calculateQuiescentInterval respects custom base and max intervals", () => {
    const base = 60_000; // 1m
    const max = 200_000; // ~3.33m

    expect(calculateQuiescentInterval(base, max, 0)).toBe(60_000);
    expect(calculateQuiescentInterval(base, max, 1)).toBe(90_000);
    expect(calculateQuiescentInterval(base, max, 2)).toBe(135_000);
    expect(calculateQuiescentInterval(base, max, 3)).toBe(200_000); // capped at 200_000
  });

  test("shouldTriggerQuiescentDigest triggers only on the 8th consecutive quiescent pulse", () => {
    expect(shouldTriggerQuiescentDigest(0)).toBe(false);
    expect(shouldTriggerQuiescentDigest(1)).toBe(false);
    expect(shouldTriggerQuiescentDigest(6)).toBe(false);
    expect(shouldTriggerQuiescentDigest(7)).toBe(false);
    expect(shouldTriggerQuiescentDigest(8)).toBe(true);
    expect(shouldTriggerQuiescentDigest(9)).toBe(false);
    expect(shouldTriggerQuiescentDigest(10)).toBe(false);
    expect(shouldTriggerQuiescentDigest(16)).toBe(false);
  });

  test("buildQuiescentDigest and formatQuiescentDigestMarkdown generate clean reports", () => {
    const sources: QuiescentSourceObservation[] = MIND_DISCOVERY_SOURCES.map((s, idx) => ({
      source: s.id,
      commandId: `cmd-ev-${idx + 1}`,
      count: 0,
      evidenceClass: s.evidenceClass,
      sourceNumber: s.number,
      sourceName: s.name,
    }));

    const digest = buildQuiescentDigest({
      streak: 8,
      sources,
      runId: "mind-gen-1",
      generatedAt: "2026-08-21T05:00:00.000Z",
    });

    expect(digest.streak).toBe(8);
    expect(digest.runId).toBe("mind-gen-1");
    expect(digest.sourcesChecked.length).toBe(10);
    expect(digest.markdown).toContain("Quiescent Repository Digest (Streak 8)");
    expect(digest.markdown).toContain("Verified Discovery Sources (10 of 10 Clean)");
    for (const s of MIND_DISCOVERY_SOURCES) {
      expect(digest.markdown).toContain(s.id);
    }
  });

  test("validateQuiescentScan accepts all 10 sources when clean and evidenced", () => {
    const fixture = setupMindFixture("validate-clean");
    const sourceInputs = buildValid10SourceFlags(fixture.commandIds);

    const validation = validateQuiescentScan(sourceInputs, {
      runRoot: fixture.mindRun,
      capsulesDir: fixture.capsulesDir,
    });

    expect(validation.ok).toBe(true);
    expect(validation.observations.length).toBe(10);
    expect(validation.missingSources.length).toBe(0);
    expect(validation.nonZeroSources.length).toBe(0);
    expect(validation.unevidencedSources.length).toBe(0);
  });

  test("validateQuiescentScan detects missing sources", () => {
    const fixture = setupMindFixture("validate-missing");
    // Pass only 9 sources (missing charter-backlog)
    const sourceInputs = fixture.commandIds
      .slice(0, 9)
      .map((cmd, idx) => `${MIND_DISCOVERY_SOURCES[idx]!.id}:${cmd}:0`);

    const validation = validateQuiescentScan(sourceInputs, {
      runRoot: fixture.mindRun,
      capsulesDir: fixture.capsulesDir,
    });

    expect(validation.ok).toBe(false);
    expect(validation.missingSources).toContain("charter-backlog");
    expect(validation.error).toContain("missing 1 source(s)");
  });

  test("validateQuiescentScan detects non-zero counts", () => {
    const fixture = setupMindFixture("validate-nonzero");
    const sourceInputs = MIND_DISCOVERY_SOURCES.map((s, idx) => {
      if (s.id === "unused-code") {
        return `${s.id}:${fixture.commandIds[idx]}:3`;
      }
      return `${s.id}:${fixture.commandIds[idx]}:0`;
    });

    const validation = validateQuiescentScan(sourceInputs, {
      runRoot: fixture.mindRun,
      capsulesDir: fixture.capsulesDir,
    });

    expect(validation.ok).toBe(false);
    expect(validation.nonZeroSources.some((n) => n.source === "unused-code" && n.count === 3)).toBe(
      true,
    );
    expect(validation.error).toContain("non-zero counts detected in sources: unused-code=3");
  });

  test("validateQuiescentScan detects unevidenced command IDs", () => {
    const fixture = setupMindFixture("validate-unevidenced");
    const sourceInputs = MIND_DISCOVERY_SOURCES.map((s, idx) => {
      if (s.id === "intent-drift") {
        return `${s.id}:cmd-does-not-exist-anywhere:0`;
      }
      return `${s.id}:${fixture.commandIds[idx]}:0`;
    });

    const validation = validateQuiescentScan(sourceInputs, {
      runRoot: fixture.mindRun,
      capsulesDir: fixture.capsulesDir,
    });

    expect(validation.ok).toBe(false);
    expect(validation.unevidencedSources.some((u) => u.source === "intent-drift")).toBe(true);
    expect(validation.error).toContain("unrecorded command evidence for sources: intent-drift");
  });
});

describe("CLI Command: mindQuiesceCommand (PLAN.md §7.5 / PHASE-3.md §3.5)", () => {
  test("enforces role 'mind' on acting agent", async () => {
    const fixture = setupMindFixture("role-check");
    // Register another agent with role 'implementer'
    agentRegisterCommand({
      run: fixture.mindRun,
      agent: "impl-1",
      role: "implementer",
      host: "antigravity",
    });

    const sources = buildValid10SourceFlags(fixture.commandIds);

    // 1. Unregistered agent
    await expect(
      mindQuiesceCommand({
        run: fixture.mindRun,
        actor: "unknown-agent",
        source: sources as unknown as string[],
      }),
    ).rejects.toThrow(HarnessError);

    // 2. Non-mind role agent
    await expect(
      mindQuiesceCommand({
        run: fixture.mindRun,
        actor: "impl-1",
        source: sources as unknown as string[],
      }),
    ).rejects.toThrow(HarnessError);
  });

  test("refuses if fewer than 10 sources are provided", async () => {
    const fixture = setupMindFixture("fewer-than-10");
    const fewerSources = fixture.commandIds
      .slice(0, 8)
      .map((cmd, idx) => `${MIND_DISCOVERY_SOURCES[idx]!.id}:${cmd}:0`);

    await expect(
      mindQuiesceCommand({
        run: fixture.mindRun,
        actor: "mind-1",
        source: fewerSources as unknown as string[],
      }),
    ).rejects.toThrow(HarnessError);
  });

  test("refuses if any source has non-zero count", async () => {
    const fixture = setupMindFixture("nonzero-refusal");
    const sourcesWithNonzero = MIND_DISCOVERY_SOURCES.map((s, idx) => {
      if (s.id === "failing-gates") {
        return `${s.id}:${fixture.commandIds[idx]}:1`;
      }
      return `${s.id}:${fixture.commandIds[idx]}:0`;
    });

    await expect(
      mindQuiesceCommand({
        run: fixture.mindRun,
        actor: "mind-1",
        source: sourcesWithNonzero as unknown as string[],
      }),
    ).rejects.toThrow(HarnessError);
  });

  test("refuses if command evidence cannot be resolved in .capsules/", async () => {
    const fixture = setupMindFixture("ghost-cmd-refusal");
    const sourcesWithGhostCmd = MIND_DISCOVERY_SOURCES.map((s, idx) => {
      if (s.id === "capsule-integrity") {
        return `${s.id}:cmd-fictional-ghost:0`;
      }
      return `${s.id}:${fixture.commandIds[idx]}:0`;
    });

    await expect(
      mindQuiesceCommand({
        run: fixture.mindRun,
        actor: "mind-1",
        source: sourcesWithGhostCmd as unknown as string[],
      }),
    ).rejects.toThrow(HarnessError);
  });

  test("successfully records quiescence, updates streak and computes 1.5x backoff", async () => {
    const fixture = setupMindFixture("quiesce-success-1", { quiescentStreak: 0 });
    const sources = buildValid10SourceFlags(fixture.commandIds);

    const result = await mindQuiesceCommand({
      run: fixture.mindRun,
      actor: "mind-1",
      source: sources as unknown as string[],
    });

    expect(result.quiescent_streak).toBe(1);
    expect(result.previous_streak).toBe(0);
    expect(result.armed_interval_ms).toBe(1_350_000); // 900_000 * 1.5
    expect(result.digest_triggered).toBe(false);
    expect(result.digest).toBeUndefined();
    expect(result.sources.length).toBe(10);
    expect(result.markdown).toContain("Mind Quiesced (Streak 1)");

    // Verify hash-chain transaction and state mutation
    const loaded = loadRun(fixture.mindRun, false);
    const pulseState = loaded.state.pulse as Record<string, unknown>;
    expect(pulseState.quiescent_streak).toBe(1);

    // Verify capsule integrity
    const integrity = verifyIntegrity(fixture.mindRun);
    expect(integrity.length).toBe(0);
  });

  test("sequential quiescence pulses increment streak and apply exponential backoff", async () => {
    const fixture = setupMindFixture("quiesce-sequence", { quiescentStreak: 0 });
    const sources = buildValid10SourceFlags(fixture.commandIds);

    // Pulse 1 -> streak 1 (1.5x = 1,350,000)
    const res1 = await mindQuiesceCommand({
      run: fixture.mindRun,
      actor: "mind-1",
      source: sources as unknown as string[],
    });
    expect(res1.quiescent_streak).toBe(1);
    expect(res1.armed_interval_ms).toBe(1_350_000);
    expect(res1.digest_triggered).toBe(false);

    // Pulse 2 -> streak 2 (2.25x = 2,025,000)
    const res2 = await mindQuiesceCommand({
      run: fixture.mindRun,
      actor: "mind-1",
      source: sources as unknown as string[],
    });
    expect(res2.quiescent_streak).toBe(2);
    expect(res2.armed_interval_ms).toBe(2_025_000);
    expect(res2.digest_triggered).toBe(false);

    // Pulse 3 -> streak 3 (3.375x = 3,037,500)
    const res3 = await mindQuiesceCommand({
      run: fixture.mindRun,
      actor: "mind-1",
      source: sources as unknown as string[],
    });
    expect(res3.quiescent_streak).toBe(3);
    expect(res3.armed_interval_ms).toBe(3_037_500);
    expect(res3.digest_triggered).toBe(false);
  });

  test("triggers digest exactly on the 8th streak pulse and none on the 9th pulse", async () => {
    const fixture = setupMindFixture("quiesce-8th-digest", { quiescentStreak: 7 });
    const sources = buildValid10SourceFlags(fixture.commandIds);

    // 8th streak pulse
    const res8 = await mindQuiesceCommand({
      run: fixture.mindRun,
      actor: "mind-1",
      source: sources as unknown as string[],
    });

    expect(res8.quiescent_streak).toBe(8);
    expect(res8.previous_streak).toBe(7);
    expect(res8.armed_interval_ms).toBe(14_400_000); // capped at max
    expect(res8.digest_triggered).toBe(true);
    expect(res8.digest).toBeDefined();
    expect(res8.digest?.streak).toBe(8);
    expect(res8.digest?.markdown).toContain("Quiescent Repository Digest (Streak 8)");
    expect(res8.markdown).toContain("Digest Triggered**: yes");

    // Verify hash chain event contains digest
    const loadedAfter8 = loadRun(fixture.mindRun, false);
    const pulseState8 = loadedAfter8.state.pulse as Record<string, unknown>;
    expect(pulseState8.quiescent_streak).toBe(8);

    // 9th streak pulse (K+1 pulse produces no digest)
    const res9 = await mindQuiesceCommand({
      run: fixture.mindRun,
      actor: "mind-1",
      source: sources as unknown as string[],
    });

    expect(res9.quiescent_streak).toBe(9);
    expect(res9.previous_streak).toBe(8);
    expect(res9.armed_interval_ms).toBe(14_400_000); // capped at max
    expect(res9.digest_triggered).toBe(false);
    expect(res9.digest).toBeUndefined();
    expect(res9.markdown).toContain("Digest Triggered**: no");

    // Verify integrity across all transactions
    const integrity = verifyIntegrity(fixture.mindRun);
    expect(integrity.length).toBe(0);
  });

  test("formatMindQuiesceBrief produces bounded output respecting line limits", () => {
    const brief = formatMindQuiesceBrief({
      runRoot: "/path/to/capsule",
      actor: "mind-1",
      quiescentStreak: 8,
      previousStreak: 7,
      baseIntervalMs: 900_000,
      maxIntervalMs: 14_400_000,
      armedIntervalMs: 14_400_000,
      digestTriggered: true,
      observedAt: "2026-08-21T05:00:00.000Z",
    });

    expect(brief).toContain("Mind Quiesced (Streak 8)");
    expect(brief).toContain("Quiescent Streak**: 8 (previous: 7)");
    expect(brief).toContain("Digest Triggered**: yes (8th consecutive quiescent pulse)");
    expect(brief.split("\n").length).toBeLessThanOrEqual(30);
  });
});
