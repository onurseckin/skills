import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CAPSULE_LAYOUT,
  initialCapsuleDirectories,
  renderLayoutReadme,
} from "../../olt/scripts/src/engine/store/layout/layout.ts";
import {
  detectContentFormat,
  normalizeContent,
  contentDigest,
  contentEquals,
} from "../../olt/scripts/src/engine/store/content-normalization/index.ts";
import { canonicalizeJson } from "../../olt/scripts/src/engine/store/content-normalization/json-canonical.ts";
import { canonicalizeYaml } from "../../olt/scripts/src/engine/store/content-normalization/yaml-canonical.ts";
import { canonicalizeEcmaScriptWhitespace } from "../../olt/scripts/src/engine/store/content-normalization/ecmascript-whitespace.ts";
import {
  appendCapsuleDefect,
  loadCapsuleDefects,
  compactCapsuleDefects,
  resolveCapsuleDefect,
} from "../../olt/scripts/src/engine/store/recovery/defect-store.ts";
import { initRun } from "../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../olt/scripts/src/engine/store/events/transaction.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("Store Layout", () => {
  test("CAPSULE_LAYOUT contains all core files and valid roles", () => {
    expect(CAPSULE_LAYOUT.length).toBeGreaterThanOrEqual(10);
    const names = CAPSULE_LAYOUT.map((entry) => entry.name);
    expect(names).toContain("manifest.json");
    expect(names).toContain("events.jsonl");
    expect(names).toContain("state.json");
    expect(names).toContain("index.json");
    expect(names).toContain("trace.md");
    expect(names).toContain("README.md");

    for (const entry of CAPSULE_LAYOUT) {
      expect(["anchor", "primary", "derived", "view", "export", "runtime"]).toContain(entry.role);
      expect(entry.responsibility.length).toBeGreaterThan(0);
    }
  });

  test("initialCapsuleDirectories returns expected primary and view directories", () => {
    const dirs = initialCapsuleDirectories();
    expect(dirs).toContain("planning");
    expect(dirs).toContain("commands");
    expect(dirs).toContain("blobs");
    expect(dirs).toContain("evidence");
    expect(dirs).toContain("reports");
  });

  test("renderLayoutReadme generates comprehensive markdown documentation", () => {
    const readme = renderLayoutReadme("test-run-1");
    expect(readme).toContain("# Capsule");
    expect(readme).toContain("manifest.json");
    expect(readme).toContain("events.jsonl");
    expect(readme).toContain("state.json");
  });
});

describe("Content Normalization", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  test("detectContentFormat identifies formats from file extensions", () => {
    expect(detectContentFormat("config.json")).toBe("json");
    expect(detectContentFormat("events.jsonl")).toBe("jsonl");
    expect(detectContentFormat("spec.yaml")).toBe("yaml");
    expect(detectContentFormat("spec.yml")).toBe("yaml");
    expect(detectContentFormat("engine.ts")).toBe("typescript");
    expect(detectContentFormat("component.tsx")).toBe("typescript");
    expect(detectContentFormat("unknown.xyz")).toBe("unknown");
  });

  test("canonicalizeJson sorts keys deterministically and preserves semantics", () => {
    const jsonA = encoder.encode('{"b": 2, "a": 1, "nested": {"z": 26, "y": 25}}');
    const jsonB = encoder.encode(
      '{\n  "a": 1,\n  "nested": {\n    "y": 25,\n    "z": 26\n  },\n  "b": 2\n}',
    );

    const canonA = canonicalizeJson(jsonA);
    const canonB = canonicalizeJson(jsonB);

    expect(canonA).toBeDefined();
    expect(canonB).toBeDefined();
    expect(decoder.decode(canonA!)).toBe(decoder.decode(canonB!));
  });

  test("canonicalizeJson returns undefined for invalid JSON", () => {
    const invalid = encoder.encode("{ invalid: json }");
    expect(canonicalizeJson(invalid)).toBeUndefined();
  });

  test("canonicalizeYaml canonicalizes valid YAML and handles errors", () => {
    const yamlContent = encoder.encode("b: 2\na: 1\n");
    const canonYaml = canonicalizeYaml(yamlContent);
    expect(canonYaml).toBeDefined();

    const invalidYaml = encoder.encode(":\n  - :: invalid :::");
    expect(canonicalizeYaml(invalidYaml)).toBeUndefined();
  });

  test("canonicalizeEcmaScriptWhitespace normalizes multi-line whitespace in source", () => {
    const source = "const x = 1;\n\n\n\nconst y = 2;\n";
    const canonical = canonicalizeEcmaScriptWhitespace(source);
    expect(canonical).toBeDefined();
    expect(canonical).not.toContain("\n\n\n");
  });

  test("normalizeContent and contentDigest produce matching digests for equivalent JSON", () => {
    const bytes1 = encoder.encode('{"name":"skills","version":"1.0.0"}');
    const bytes2 = encoder.encode('{\n  "version": "1.0.0",\n  "name": "skills"\n}');

    const digest1 = contentDigest(bytes1, "package.json");
    const digest2 = contentDigest(bytes2, "package.json");

    expect(digest1.method).toBe("json-canonical");
    expect(digest2.method).toBe("json-canonical");
    expect(digest1.sha256).toBe(digest2.sha256);

    const comparison = contentEquals(bytes1, bytes2, "json");
    expect(comparison.equal).toBe(true);
  });
});

describe("Defect Store", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `test-defect-store-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("appendCapsuleDefect logs defects to defects.jsonl and loadCapsuleDefects retrieves them", () => {
    const defectInput = {
      type: "validation_failure",
      severity: "high" as const,
      summary: "Test gate failed",
      dedup_key: "gate_fail_task_1",
      details: { taskId: "task-1" },
    };

    const recorded = appendCapsuleDefect(testDir, defectInput);
    expect(recorded.id).toBeDefined();
    expect(recorded.dedup_key).toBe("gate_fail_task_1");

    const loaded = loadCapsuleDefects(testDir);
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.dedup_key).toBe("gate_fail_task_1");
  });

  test("resolveCapsuleDefect marks existing defect as resolved", () => {
    appendCapsuleDefect(testDir, {
      type: "syntax_error",
      severity: "critical" as const,
      summary: "Syntax error in module",
      dedup_key: "syntax_err_1",
    });

    const resolved = resolveCapsuleDefect(testDir, "syntax_err_1", {
      task_id: "task-1",
      test_assertion: "passes syntax validation",
      resolved_at: "2026-08-24T12:00:00.000Z",
      verified_by: "implementer",
      remediation_notes: "Fixed syntax error in source file",
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.status).toBe("resolved");

    const reloaded = loadCapsuleDefects(testDir);
    expect(reloaded[0]?.status).toBe("resolved");
  });

  test("compactCapsuleDefects compacts duplicate defect entries", () => {
    appendCapsuleDefect(testDir, {
      type: "lint_warning",
      severity: "low" as const,
      summary: "Trailing whitespace",
      dedup_key: "ws_warn",
    });
    appendCapsuleDefect(testDir, {
      type: "lint_warning",
      severity: "low" as const,
      summary: "Trailing whitespace repeated",
      dedup_key: "ws_warn",
    });

    const compaction = compactCapsuleDefects(testDir);
    expect(compaction.totalBefore).toBeGreaterThanOrEqual(1);
    expect(compaction.totalAfter).toBe(1);
  });

  test("defect store operations throw on missing or empty runRoot", () => {
    expect(() => appendCapsuleDefect("", { type: "k", severity: "low" as const })).toThrow(
      HarnessError,
    );
    expect(() =>
      resolveCapsuleDefect("", "k", {
        task_id: "task-1",
        test_assertion: "test",
        resolved_at: "2026-08-24T12:00:00.000Z",
      }),
    ).toThrow(HarnessError);
    expect(loadCapsuleDefects("")).toEqual([]);
    expect(compactCapsuleDefects("")).toEqual({ totalBefore: 0, totalAfter: 0 });
  });
});

describe("Capsule Transaction and Event Append", () => {
  let testRepo: string;
  let runRoot: string;

  beforeEach(() => {
    testRepo = join(
      tmpdir(),
      `test-store-run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRepo, { recursive: true });
    runRoot = initRun(
      testRepo,
      "test-run-1",
      new TextEncoder().encode("Test prompt content"),
      "file",
      true,
    );
  });

  afterEach(() => {
    if (existsSync(testRepo)) {
      rmSync(testRepo, { recursive: true, force: true });
    }
  });

  test("transact executes state mutations and appends projection events with incrementing sequence", () => {
    const state1 = transact(
      runRoot,
      "orchestrator",
      "test_event_1",
      { note: "first mutation" },
      (draft) => {
        draft.phase = "planning";
      },
    );

    expect(state1.event_sequence).toBe(1);
    expect(state1.revision).toBe(1);
    expect(state1.phase).toBe("planning");

    const state2 = transact(
      runRoot,
      "orchestrator",
      "test_event_2",
      { note: "second mutation" },
      (draft) => {
        draft.phase = "executing";
      },
    );

    expect(state2.event_sequence).toBe(2);
    expect(state2.revision).toBe(2);
    expect(state2.phase).toBe("executing");

    const eventsContent = readFileSync(join(runRoot, "events.jsonl"), "utf8");
    const lines = eventsContent.trim().split("\n");
    expect(lines.length).toBe(2);
  });

  test("transact enforces maxEventCount limits", () => {
    expect(() =>
      transact(
        runRoot,
        "actor",
        "kind",
        {},
        (draft) => {
          draft.phase = "overflow";
        },
        { maxEventCount: 0 },
      ),
    ).toThrow(HarnessError);
  });
});
