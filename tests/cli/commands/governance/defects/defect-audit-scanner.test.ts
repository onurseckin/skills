import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverDefectFiles,
  parseDefectsFromFile,
} from "../../../../../olt/scripts/src/cli/commands/defect-audit-scanner.ts";
import {
  discoverDefectFiles as discoverDefectFiles2,
  parseDefectsFromFile as parseDefectsFromFile2,
} from "../../../../../olt/scripts/src/cli/commands/defect-audit/discovery.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Defect Scanner & Discovery", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `defect-audit-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "package.json"), "{}", "utf-8");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("discoverDefectFiles finds root, subdirectory, and explicit files", () => {
    const cap1 = join(testDir, "run-1");
    const cap2 = join(testDir, "run-2");
    const outsideDir = join(
      tmpdir(),
      `outside-run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(cap1, { recursive: true });
    mkdirSync(cap2, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "package.json"), "{}", "utf-8");
    roots.push(outsideDir);

    writeFileSync(join(testDir, "defects.jsonl"), '{"id":"d0","type":"t"}\n');
    writeFileSync(join(cap1, "defects.jsonl"), '{"id":"d1","type":"t"}\n');
    writeFileSync(join(outsideDir, "defects.jsonl"), '{"id":"d-out","type":"t"}\n');

    const discovered = discoverDefectFiles(testDir);
    expect(discovered.some((d) => d.capsuleName === "capsules-root")).toBe(true);
    expect(discovered.some((d) => d.capsuleName === "run-1")).toBe(true);
    expect(discovered.some((d) => d.capsuleName === "run-2")).toBe(false);

    const explicit = discoverDefectFiles(testDir, outsideDir);
    expect(explicit.length).toBeGreaterThanOrEqual(3);

    const discovered2Only = discoverDefectFiles2(testDir);
    expect(discovered2Only.some((d) => d.capsuleName === "run-1")).toBe(true);

    const discovered2 = discoverDefectFiles2(testDir, outsideDir);
    expect(discovered2.length).toBeGreaterThanOrEqual(3);
  });

  test("discoverDefectFiles finds canonical .olt defects and completed-defects", () => {
    const oltDir = join(testDir, ".olt");
    mkdirSync(oltDir, { recursive: true });
    writeFileSync(join(oltDir, "defects.jsonl"), '{"id":"d-can","type":"t"}\n');
    writeFileSync(join(oltDir, "completed-defects.jsonl"), '{"id":"d-comp","type":"t"}\n');

    const discovered = discoverDefectFiles(testDir);
    expect(discovered.some((d) => d.capsuleName === ".olt")).toBe(true);

    const discovered2 = discoverDefectFiles2(testDir);
    expect(discovered2.some((d) => d.capsuleName === ".olt")).toBe(true);
  });

  test("parseDefectsFromFile handles missing files, invalid JSON, and state.json candidates", () => {
    expect(
      parseDefectsFromFile({ capsuleName: "c1", filePath: join(testDir, "none.jsonl") }, testDir),
    ).toEqual([]);
    expect(
      parseDefectsFromFile2({ capsuleName: "c1", filePath: join(testDir, "none.jsonl") }, testDir),
    ).toEqual([]);

    expect(parseDefectsFromFile({ capsuleName: "c1", filePath: testDir }, testDir)).toEqual([]);
    expect(parseDefectsFromFile2({ capsuleName: "c1", filePath: testDir }, testDir)).toEqual([]);

    const capsuleDir = join(testDir, "cap-test");
    mkdirSync(capsuleDir, { recursive: true });

    const stateObj = {
      candidates: [
        { id: "cand-1", witness: "d-resolved", status: "resolved" },
        { id: "cand-2", witness_command_id: "d-declined", status: "rejected" },
        { id: "cand-3", witness: "d-admitted", status: "proposed" },
        "invalid-candidate",
        null,
      ],
    };
    writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(stateObj), "utf-8");

    const defectsFile = join(capsuleDir, "defects.jsonl");
    const lines = [
      "",
      "not valid json {",
      JSON.stringify({
        id: "d-resolved",
        type: "code_defect",
        severity: "critical",
        status: "open",
        resolution: {
          task_id: "task-1",
          test_assertion: "bun test tests/domain/router.test.ts",
          resolved_at: "2026-08-30T12:00:00.000Z",
        },
      }),
      JSON.stringify({
        id: "d-declined",
        type: "security_defect",
        severity: "warning",
        status: "open",
        resolution: null,
      }),
      JSON.stringify({
        id: "d-admitted",
        type: "perf_defect",
        severity: "info",
        status: "open",
      }),
      JSON.stringify({
        id: "d-ignored",
        type: "arch_defect",
        severity: "warning",
        status: "ignored",
      }),
    ].join("\n");
    writeFileSync(defectsFile, lines, "utf-8");

    const parsed = parseDefectsFromFile(
      { capsuleName: "cap-test", filePath: defectsFile },
      testDir,
    );
    expect(parsed).toHaveLength(4);

    const d1 = parsed.find((d) => d.id === "d-resolved")!;
    expect(d1.status).toBe("resolved");
    expect(d1.candidate_id).toBe("cand-1");
    expect(d1.severity).toBe("critical");
    expect(d1.resolution).toBeDefined();

    const d2 = parsed.find((d) => d.id === "d-declined")!;
    expect(d2.status).toBe("declined");
    expect(d2.candidate_id).toBe("cand-2");

    const d3 = parsed.find((d) => d.id === "d-admitted")!;
    expect(d3.status).toBe("admitted");

    const d4 = parsed.find((d) => d.id === "d-ignored")!;
    expect(d4.status).toBe("ignored");

    const parsed2 = parseDefectsFromFile2(
      { capsuleName: "cap-test", filePath: defectsFile },
      testDir,
    );
    expect(parsed2).toHaveLength(4);
  });
});
