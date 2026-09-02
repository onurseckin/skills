import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  parseQuiescentSourceSpec,
  tryParseQuiescentSourceSpec,
  validateQuiescentScan,
  QUIESCENT_DIGEST_STREAK_THRESHOLD,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  QUIESCENCE_INTERVAL_MULTIPLIER,
} from "../../../../olt/scripts/src/mind/archival/quiesce/types.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupVirtualStoreFS,
  scratchRoot,
  setupVirtualStoreFS,
} from "../../../store/store-fixture.ts";

describe("Mind Archival Quiesce Types & Scanner Suite", () => {
  beforeEach(() => {
    setupVirtualStoreFS();
  });

  afterEach(() => {
    cleanupVirtualStoreFS();
  });

  function setupFixture(label: string) {
    const repoRoot = scratchRoot(import.meta.path, `${label}-repo`);
    const prompt = new TextEncoder().encode("Mind test prompt");
    const runRoot = initRun(repoRoot, `run-${label}`, prompt, "file", true);
    transact(runRoot, "coordinator", "seed-cmd", {}, (draft) => {
      draft.commands = {
        "C-valid-1": { id: "C-valid-1", exit_code: 0 },
        "C-valid-2": { id: "C-valid-2", exit_code: 0 },
      };
    });
    return { repoRoot, runRoot };
  }

  const ALL_10_SOURCES = [
    "intent-drift:C-valid-1:0",
    "unused-code:C-valid-1:0",
    "literal-fallbacks:C-valid-1:0",
    "open-findings:C-valid-1:0",
    "escalated-tasks:C-valid-1:0",
    "failing-gates:C-valid-1:0",
    "capsule-integrity:C-valid-1:0",
    "install-drift:C-valid-1:0",
    "unsealed-capsules:C-valid-1:0",
    "charter-backlog:C-valid-1:0",
  ];

  it("exports constants properly", () => {
    expect(QUIESCENT_DIGEST_STREAK_THRESHOLD).toBe(8);
    expect(DEFAULT_BASE_INTERVAL_MS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_INTERVAL_MS).toBeGreaterThan(0);
    expect(QUIESCENCE_INTERVAL_MULTIPLIER).toBe(1.5);
  });

  it("parseQuiescentSourceSpec parses valid source specifications including nested colons", () => {
    const res1 = parseQuiescentSourceSpec("intent-drift:C-101:0");
    expect(res1).toEqual({ source: "intent-drift", commandId: "C-101", count: 0 });

    const res2 = parseQuiescentSourceSpec("  unused-code : C:sub:202 : 5  ");
    expect(res2).toEqual({ source: "unused-code", commandId: "C:sub:202", count: 5 });
  });

  it("parseQuiescentSourceSpec throws HarnessError on invalid formats", () => {
    expect(() => parseQuiescentSourceSpec("")).toThrow("invalid source spec");
    expect(() => parseQuiescentSourceSpec("   ")).toThrow("invalid source spec");
    expect(() => parseQuiescentSourceSpec(null as unknown as string)).toThrow();
    expect(() => parseQuiescentSourceSpec("only-one-part")).toThrow();
    expect(() => parseQuiescentSourceSpec("source:command")).toThrow();
    expect(() => parseQuiescentSourceSpec(":command:0")).toThrow("missing source name");
    expect(() => parseQuiescentSourceSpec("source::0")).toThrow("missing command id");
    expect(() => parseQuiescentSourceSpec("source:cmd:-1")).toThrow(
      "count must be an integer >= 0",
    );
    expect(() => parseQuiescentSourceSpec("source:cmd:not-a-number")).toThrow();
    expect(() => parseQuiescentSourceSpec("source:cmd:2.5")).toThrow();
  });

  it("tryParseQuiescentSourceSpec returns structured success or error object", () => {
    const okRes = tryParseQuiescentSourceSpec("failing-gates:C-gate:0");
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.value.source).toBe("failing-gates");
      expect(okRes.value.commandId).toBe("C-gate");
      expect(okRes.value.count).toBe(0);
    }

    const errRes = tryParseQuiescentSourceSpec("bad-spec");
    expect(errRes.ok).toBe(false);
    if (!errRes.ok) {
      expect(typeof errRes.error).toBe("string");
    }
  });

  it("validateQuiescentScan accepts object inputs and string inputs together", () => {
    const { runRoot, repoRoot } = setupFixture("scan-mix");

    const inputs = [
      "intent-drift:C-valid-1:0",
      { source: "unused-code", commandId: "C-valid-1", count: 0 },
      "literal-fallbacks:C-valid-1:0",
      { source: "open-findings", commandId: "C-valid-1", count: 0 },
      "escalated-tasks:C-valid-1:0",
      { source: "failing-gates", commandId: "C-valid-1", count: 0 },
      "capsule-integrity:C-valid-1:0",
      { source: "install-drift", commandId: "C-valid-1", count: 0 },
      "unsealed-capsules:C-valid-1:0",
      { source: "charter-backlog", commandId: "C-valid-1", count: 0 },
    ];

    const result = validateQuiescentScan(inputs, { runRoot, repoRoot });
    expect(result.ok).toBe(true);
    expect(result.observations.length).toBe(10);
    expect(result.missingSources.length).toBe(0);
    expect(result.nonZeroSources.length).toBe(0);
    expect(result.invalidSources.length).toBe(0);
    expect(result.unevidencedSources.length).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it("validateQuiescentScan detects invalid string and object inputs and unknown sources", () => {
    const { runRoot, repoRoot } = setupFixture("scan-invalid");

    const inputs = [
      "invalid-formatted-string",
      { source: "intent-drift", commandId: "C-1", count: -1 }, // invalid count
      { source: "", commandId: "C-1", count: 0 }, // empty source
      { source: "unknown-source-name", commandId: "C-1", count: 0 }, // unknown source
      null as unknown as string,
    ];

    const result = validateQuiescentScan(inputs, { runRoot, repoRoot });
    expect(result.ok).toBe(false);
    expect(result.invalidSources.length).toBeGreaterThan(0);
    expect(result.error).toContain("invalid source specifications");
  });

  it("validateQuiescentScan prioritizes error reporting: missing sources, non-zero counts, unevidenced", () => {
    const { runRoot, repoRoot } = setupFixture("scan-priorities");

    // 1. Missing sources error
    const resMissing = validateQuiescentScan(ALL_10_SOURCES.slice(0, 8), { runRoot, repoRoot });
    expect(resMissing.ok).toBe(false);
    expect(resMissing.error).toContain("missing 2 source(s)");

    // 2. Non-zero counts error
    const nonZeroList = [...ALL_10_SOURCES.slice(0, 9), "charter-backlog:C-valid-1:4"];
    const resNonZero = validateQuiescentScan(nonZeroList, { runRoot, repoRoot });
    expect(resNonZero.ok).toBe(false);
    expect(resNonZero.error).toContain("non-zero counts detected in sources: charter-backlog=4");

    // 3. Unevidenced command error
    const unevidencedList = [...ALL_10_SOURCES.slice(0, 9), "charter-backlog:C-missing-evidence:0"];
    const resUnevidenced = validateQuiescentScan(unevidencedList, { runRoot, repoRoot });
    expect(resUnevidenced.ok).toBe(false);
    expect(resUnevidenced.error).toContain(
      "unrecorded command evidence for sources: charter-backlog",
    );
  });
});
