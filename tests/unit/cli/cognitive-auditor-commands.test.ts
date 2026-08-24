import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mindAuditLiveCommand } from "../../../olt/scripts/src/cli/commands/mind-audit-live.ts";
import { skillAuditLiveCommand } from "../../../olt/scripts/src/cli/commands/skill-audit-live.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import { AuditorCursorStore } from "../../../olt/scripts/src/mind/cognitive-auditors.ts";

const MIN_MANIFEST_YAML = `role: mind
tier: 0
spawns:
  - orchestrator
may:
  - Coordinate strategic goals
must_not:
  - Implement code directly
`;

describe("CLI Cognitive Auditor Commands (mind:audit:live & skill:audit:live)", () => {
  let testDir: string;
  let runDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `test-cognitive-cli-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    runDir = join(testDir, "capsules", "run-1");
    mkdirSync(join(testDir, ".olt"), { recursive: true });
    mkdirSync(join(testDir, "olt", "agents"), { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(testDir, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML, "utf-8");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Command Registry Verification", () => {
    test("registers mind:audit:live and its alias mind:audit in mind domain", () => {
      const spec = findCommand("mind:audit:live");
      expect(spec).toBeDefined();
      expect(spec?.name).toBe("mind:audit:live");
      expect(spec?.domain).toBe("mind");
      expect(spec?.aliases).toContain("mind:audit");
      expect(findCommand("mind:audit")).toBe(spec);

      const flagNames = spec?.flags.map((f) => f.name);
      expect(flagNames).toContain("repo");
      expect(flagNames).toContain("threshold");
      expect(flagNames).toContain("conversation-id");
      expect(flagNames).toContain("json");
    });

    test("registers skill:audit:live and its alias skill:audit in reporting domain", () => {
      const spec = findCommand("skill:audit:live");
      expect(spec).toBeDefined();
      expect(spec?.name).toBe("skill:audit:live");
      expect(spec?.domain).toBe("reporting");
      expect(spec?.aliases).toContain("skill:audit");
      expect(findCommand("skill:audit")).toBe(spec);

      const flagNames = spec?.flags.map((f) => f.name);
      expect(flagNames).toContain("repo");
      expect(flagNames).toContain("run");
      expect(flagNames).toContain("log-defects");
      expect(flagNames).toContain("json");
    });
  });

  describe("mindAuditLiveCommand Handler", () => {
    test("returns healthy active state when mind activity is within threshold", async () => {
      AuditorCursorStore.saveCursor(testDir, "mind", {
        lastInspectedTimestamp: new Date().toISOString(),
        lastInspectedEventIndex: 0,
      });

      const result = await mindAuditLiveCommand(
        { repo: testDir, threshold: 120 },
        { suppressStdout: true },
      );

      expect(result["stagnant"]).toBe(false);
      expect(result["defect_created"]).toBe(false);
      expect(result["injection_prompt"]).toBeNull();
      expect(typeof result["output"]).toBe("string");

      const output = String(result["output"]);
      expect(output).toContain("# Tier 0 Mind Live Audit: HEALTHY");
      expect(output).toContain("✓ ACTIVE");
      const lineCount = output.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(30);
    });

    test("detects stagnation and returns formatted brief with injection prompt", async () => {
      AuditorCursorStore.saveCursor(testDir, "mind", {
        lastInspectedTimestamp: "2026-08-24T00:00:00.000Z",
        lastInspectedEventIndex: 0,
      });

      const result = await mindAuditLiveCommand(
        {
          repo: testDir,
          threshold: 60,
          "conversation-id": "conv-test-123",
        },
        { suppressStdout: true },
      );

      expect(result["stagnant"]).toBe(true);
      expect(result["defect_created"]).toBe(true);
      expect(typeof result["injection_prompt"]).toBe("string");
      expect(String(result["injection_prompt"])).toContain(
        "CRITICAL SUPERVISORY ALERT: Live Stagnation Detected",
      );

      const output = String(result["output"]);
      expect(output).toContain("# Tier 0 Mind Live Audit: STAGNANT");
      expect(output).toContain("⚠️ STAGNANT (>120s)");
      expect(output).toContain("## Verbatim Injection Prompt Generated:");
      const lineCount = output.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(30);
    });

    test("supports --json flag returning structured payload", async () => {
      const result = await mindAuditLiveCommand(
        { repo: testDir, json: true },
        { suppressStdout: true },
      );

      expect(typeof result["stagnant"]).toBe("boolean");
      expect(typeof result["idle_duration_seconds"]).toBe("number");
      expect(typeof result["pending_backlog_count"]).toBe("number");
      expect(typeof result["unresolved_defect_count"]).toBe("number");
      expect(typeof result["defect_created"]).toBe("boolean");
      expect(result["cursor"]).toBeDefined();
      expect(typeof result["output"]).toBe("string");
    });
  });

  describe("skillAuditLiveCommand Handler", () => {
    test("returns compliant when event log has zero boundary violations", async () => {
      const eventsPath = join(runDir, "events.jsonl");
      const e1 = JSON.stringify({ kind: "tool-called", tool: "view_file", actor: "implementer-1" });
      writeFileSync(eventsPath, `${e1}\n`, "utf-8");

      const result = await skillAuditLiveCommand(
        { repo: testDir, run: runDir },
        { suppressStdout: true },
      );

      expect(result["compliant"]).toBe(true);
      expect(result["incidents_count"]).toBe(0);
      expect(result["defects_logged"]).toBe(0);
      expect(result["events_analyzed"]).toBe(1);

      const output = String(result["output"]);
      expect(output).toContain("# Tier 0 Skill Compliance Live Audit: COMPLIANT");
      expect(output).toContain("✓ COMPLIANT");
      const lineCount = output.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(30);
    });

    test("detects violations, logs defects, and formats incident list", async () => {
      const eventsPath = join(runDir, "events.jsonl");
      const e1 = JSON.stringify({
        type: "boundary_violation",
        error_code: "ROLE_BOUNDARY_DEVIATION",
        message: "Coordinator executed direct file write",
      });
      writeFileSync(eventsPath, `${e1}\n`, "utf-8");

      const result = await skillAuditLiveCommand(
        { repo: testDir, run: runDir },
        { suppressStdout: true },
      );

      expect(result["compliant"]).toBe(false);
      expect(result["incidents_count"]).toBe(1);
      expect(result["defects_logged"]).toBe(1);

      const output = String(result["output"]);
      expect(output).toContain("# Tier 0 Skill Compliance Live Audit: NON_COMPLIANT");
      expect(output).toContain("⚠️ 1 INCIDENTS");
      expect(output).toContain("## Forensics Incidents Detected:");
      expect(output).toContain("ROLE_BOUNDARY_DEVIATION: Coordinator executed direct file write");
      const lineCount = output.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(30);
    });

    test("respects --log-defects false flag", async () => {
      const eventsPath = join(runDir, "events.jsonl");
      const e1 = JSON.stringify({
        type: "boundary_violation",
        error_code: "ROLE_BOUNDARY_DEVIATION",
        message: "Validator executed test suite",
      });
      writeFileSync(eventsPath, `${e1}\n`, "utf-8");

      const result = await skillAuditLiveCommand(
        { repo: testDir, run: runDir, "log-defects": false },
        { suppressStdout: true },
      );

      expect(result["compliant"]).toBe(false);
      expect(result["incidents_count"]).toBe(1);
      expect(result["defects_logged"]).toBe(0);
    });

    test("supports --json flag returning structured payload", async () => {
      const result = await skillAuditLiveCommand(
        { repo: testDir, run: runDir, json: true },
        { suppressStdout: true },
      );

      expect(typeof result["compliant"]).toBe("boolean");
      expect(typeof result["incidents_count"]).toBe("number");
      expect(typeof result["events_analyzed"]).toBe("number");
      expect(typeof result["defects_logged"]).toBe("number");
      expect(result["cursor"]).toBeDefined();
      expect(typeof result["output"]).toBe("string");
    });
  });

  describe("Harness CLI execute Integration", () => {
    test("executes mind:audit:live and mind:audit via CLI harness", async () => {
      AuditorCursorStore.saveCursor(testDir, "mind", {
        lastInspectedTimestamp: new Date().toISOString(),
        lastInspectedEventIndex: 0,
      });

      const resLive = await execute(["mind:audit:live", "--repo", testDir, "--json"], {
        suppressStdout: true,
      });
      expect(resLive["stagnant"]).toBe(false);

      const resAlias = await execute(["mind:audit", "--repo", testDir, "--json"], {
        suppressStdout: true,
      });
      expect(resAlias["stagnant"]).toBe(false);
    });

    test("executes skill:audit:live and skill:audit via CLI harness", async () => {
      const resLive = await execute(
        ["skill:audit:live", "--repo", testDir, "--run", runDir, "--json"],
        { suppressStdout: true },
      );
      expect(resLive["compliant"]).toBe(true);

      const resAlias = await execute(
        ["skill:audit", "--repo", testDir, "--run", runDir, "--json"],
        { suppressStdout: true },
      );
      expect(resAlias["compliant"]).toBe(true);
    });
  });

  describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    test("verifies test file and implementation files contain zero any and zero suppressions", () => {
      const targetFiles = [
        join(import.meta.dir, "../../../olt/scripts/src/cli/commands/mind-audit-live.ts"),
        join(import.meta.dir, "../../../olt/scripts/src/cli/commands/skill-audit-live.ts"),
        import.meta.path,
      ];

      const forbiddenAnyRegex = new RegExp(":[ \\t]*" + "any\\b");
      const forbiddenCastRegex = new RegExp("\\bas[ \\t]+" + "any\\b");
      const forbiddenSuppressionsRegex = new RegExp("@ts-" + "(ignore|expect-error|nocheck)");
      const forbiddenLintRegex = new RegExp("(eslint|oxlint)" + "-disable");

      for (const filePath of targetFiles) {
        const content = readFileSync(filePath, "utf-8");
        expect(content).not.toMatch(forbiddenAnyRegex);
        expect(content).not.toMatch(forbiddenCastRegex);
        expect(content).not.toMatch(forbiddenSuppressionsRegex);
        expect(content).not.toMatch(forbiddenLintRegex);
      }
    });
  });
});
