import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseBlunderLog,
  serializeBlunderLog,
  type BlunderEntry,
} from "../../../orchestrating-long-tasks/scripts/src/mind/blunders.ts";

describe("Diagnostics Blunder Ingestion Engine", () => {
  const repoRoot = process.cwd();
  const historicalBlundersPath = join(repoRoot, ".capsules", "blunders.jsonl");

  describe("Historical .capsules/blunders.jsonl Ingestion", () => {
    test("successfully parses all historical blunder records without crashing", () => {
      if (!existsSync(historicalBlundersPath)) {
        return;
      }

      const content = readFileSync(historicalBlundersPath, "utf8");
      const parsed = parseBlunderLog(content);

      expect(parsed.length).toBeGreaterThanOrEqual(280);

      // Verify every parsed item has required canonical fields
      for (let i = 0; i < parsed.length; i += 1) {
        const item = parsed[i];
        expect(item !== undefined).toBeTrue();
        if (item !== undefined) {
          expect(typeof item.id).toBe("string");
          expect(item.id.length).toBeGreaterThan(0);
          expect(typeof item.type).toBe("string");
          expect(typeof item.severity).toBe("string");
          expect(typeof item.timestamp).toBe("string");
          expect(["code_defect", "model_reasoning_error", "boundary_violation"]).toContain(
            item.category,
          );
          expect(["open", "resolved", "wontfix"]).toContain(item.status);
          expect(typeof item.observation).toBe("string");
          expect(typeof item.remediation).toBe("string");
        }
      }
    });

    test("correctly parses historical record: blunder-20260821-08-orch-role-leak", () => {
      if (!existsSync(historicalBlundersPath)) {
        return;
      }

      const content = readFileSync(historicalBlundersPath, "utf8");
      const parsed = parseBlunderLog(content);
      const entry = parsed.find((b) => b.id === "blunder-20260821-08-orch-role-leak");

      expect(entry !== undefined).toBeTrue();
      if (entry !== undefined) {
        expect(entry.id).toBe("blunder-20260821-08-orch-role-leak");
        expect(entry.category).toBe("boundary_violation");
        expect(entry.severity).toBe("high");
        expect(entry.role).toBe("orchestrator");
        expect(["open", "resolved"]).toContain(entry.status);
        expect(entry.observation).toContain("Tier 1 Orchestrator attempted direct file edits");
        expect(entry.message).toContain("Tier 1 Orchestrator attempted direct file edits");
        expect(entry.remediation).toContain("Enforce strict CLI-level write restrictions");
        expect(entry.prescribed_remediation).toContain(
          "Enforce strict CLI-level write restrictions",
        );
      }
    });

    test("correctly parses historical record: blunder-20260821-09-mind-plan-revision-paralysis", () => {
      if (!existsSync(historicalBlundersPath)) {
        return;
      }

      const content = readFileSync(historicalBlundersPath, "utf8");
      const parsed = parseBlunderLog(content);
      const entry = parsed.find((b) => b.id === "blunder-20260821-09-mind-plan-revision-paralysis");

      expect(entry !== undefined).toBeTrue();
      if (entry !== undefined) {
        expect(entry.id).toBe("blunder-20260821-09-mind-plan-revision-paralysis");
        expect(entry.category).toBe("model_reasoning_error");
        expect(entry.severity).toBe("high");
        expect(entry.role).toBe("mind");
        expect(["open", "resolved"]).toContain(entry.status);
        expect(entry.observation).toContain("Tier 0 Mind exhibited passive inertia");
        expect(entry.remediation).toContain(
          "Tier 0 Mind must actively use plan revision mechanisms",
        );
      }
    });

    test("correctly parses historical record: blunder-20260821-10-identity-and-role-amnesia with role_confusion mapping", () => {
      if (!existsSync(historicalBlundersPath)) {
        return;
      }

      const content = readFileSync(historicalBlundersPath, "utf8");
      const parsed = parseBlunderLog(content);
      const entry = parsed.find((b) => b.id === "blunder-20260821-10-identity-and-role-amnesia");

      expect(entry !== undefined).toBeTrue();
      if (entry !== undefined) {
        expect(entry.id).toBe("blunder-20260821-10-identity-and-role-amnesia");
        expect(entry.category).toBe("boundary_violation");
        expect(entry.severity).toBe("high");
        expect(entry.role).toBe("orchestrator_and_mind");
        expect(["open", "resolved"]).toContain(entry.status);
        expect(entry.observation).toContain("whoami");
        expect(entry.remediation).toContain("Mandate `whoami` self-identification");
      }
    });

    test("correctly parses historical record: blunder-20260821-12-mind-self-termination-and-idle-death", () => {
      if (!existsSync(historicalBlundersPath)) {
        return;
      }

      const content = readFileSync(historicalBlundersPath, "utf8");
      const parsed = parseBlunderLog(content);
      const entry = parsed.find(
        (b) => b.id === "blunder-20260821-12-mind-self-termination-and-idle-death",
      );

      expect(entry !== undefined).toBeTrue();
      if (entry !== undefined) {
        expect(entry.id).toBe("blunder-20260821-12-mind-self-termination-and-idle-death");
        expect(entry.category).toBe("boundary_violation");
        expect(entry.severity).toBe("critical");
        expect(entry.role).toBe("mind");
        expect(entry.status).toBe("resolved");
        expect(entry.observation).toContain("mind:pulse-close");
        expect(entry.remediation).toContain("recycler.ts");
      }
    });
  });

  describe("Synthetic Schema Variations & Edge Cases", () => {
    test("handles empty and whitespace-only content", () => {
      expect(parseBlunderLog("")).toEqual([]);
      expect(parseBlunderLog("   \n\n\t  \n ")).toEqual([]);
    });

    test("skips malformed and corrupted JSON lines", () => {
      const input = [
        "not a json line",
        "{ unquoted_key: 123 }",
        "42",
        "true",
        "null",
        "[]",
        JSON.stringify({ id: "valid-synth-1", type: "syntax_error", observation: "missing token" }),
        "truncated {",
      ].join("\n");

      const results = parseBlunderLog(input);
      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe("valid-synth-1");
      expect(results[0]?.category).toBe("code_defect");
    });

    test("supports observation falling back to message and vice versa", () => {
      const lineMsgOnly = JSON.stringify({
        id: "b-msg-only",
        message: "Direct main thread execution without delegation",
        prescribed_remediation: "Dispatch Tier 3 worker",
      });

      const lineObsOnly = JSON.stringify({
        id: "b-obs-only",
        observation: "Direct main thread execution without delegation",
        remediation: "Dispatch Tier 3 worker",
      });

      const parsedMsg = parseBlunderLog(lineMsgOnly);
      expect(parsedMsg.length).toBe(1);
      expect(parsedMsg[0]?.observation).toBe("Direct main thread execution without delegation");
      expect(parsedMsg[0]?.message).toBe("Direct main thread execution without delegation");
      expect(parsedMsg[0]?.remediation).toBe("Dispatch Tier 3 worker");
      expect(parsedMsg[0]?.prescribed_remediation).toBe("Dispatch Tier 3 worker");

      const parsedObs = parseBlunderLog(lineObsOnly);
      expect(parsedObs.length).toBe(1);
      expect(parsedObs[0]?.observation).toBe("Direct main thread execution without delegation");
      expect(parsedObs[0]?.message).toBe("Direct main thread execution without delegation");
      expect(parsedObs[0]?.remediation).toBe("Dispatch Tier 3 worker");
      expect(parsedObs[0]?.prescribed_remediation).toBe("Dispatch Tier 3 worker");
    });

    test("normalizes severity to lowercase canonical string", () => {
      const lines = [
        JSON.stringify({ id: "s-1", severity: "CRITICAL" }),
        JSON.stringify({ id: "s-2", severity: "HIGH" }),
        JSON.stringify({ id: "s-3", severity: "Warning" }),
        JSON.stringify({ id: "s-4", severity: "LOW" }),
        JSON.stringify({ id: "s-5", severity: "INFO" }),
        JSON.stringify({ id: "s-6" }), // Missing defaults to warning
      ].join("\n");

      const parsed = parseBlunderLog(lines);
      expect(parsed[0]?.severity).toBe("critical");
      expect(parsed[1]?.severity).toBe("high");
      expect(parsed[2]?.severity).toBe("warning");
      expect(parsed[3]?.severity).toBe("low");
      expect(parsed[4]?.severity).toBe("info");
      expect(parsed[5]?.severity).toBe("warning");
    });

    test("normalizes status case-insensitively and handles variants", () => {
      const lines = [
        JSON.stringify({ id: "st-1", status: "OPEN" }),
        JSON.stringify({ id: "st-2", status: "open" }),
        JSON.stringify({ id: "st-3", status: "RESOLVED" }),
        JSON.stringify({ id: "st-4", status: "resolved" }),
        JSON.stringify({ id: "st-5", status: "WONTFIX" }),
        JSON.stringify({ id: "st-6", status: "WONT_FIX" }),
        JSON.stringify({ id: "st-7", status: "wont-fix" }),
        JSON.stringify({ id: "st-8", status: "UNKNOWN" }),
      ].join("\n");

      const parsed = parseBlunderLog(lines);
      expect(parsed[0]?.status).toBe("open");
      expect(parsed[1]?.status).toBe("open");
      expect(parsed[2]?.status).toBe("resolved");
      expect(parsed[3]?.status).toBe("resolved");
      expect(parsed[4]?.status).toBe("wontfix");
      expect(parsed[5]?.status).toBe("wontfix");
      expect(parsed[6]?.status).toBe("wontfix");
      expect(parsed[7]?.status).toBe("open");
    });

    test("preserves context metadata and extracts role and process hierarchy", () => {
      const entryObj = {
        id: "b-context",
        type: "main_thread_direct_execution",
        role: "orchestrator",
        pid: 12345,
        ppid: 12344,
        agent_id: "agent-orch-01",
        context: {
          cwd: "/path/to/repo",
          indicators: { INTERACTIVE: "1" },
          custom_tag: "test-tag",
        },
      };

      const parsed = parseBlunderLog(JSON.stringify(entryObj));
      expect(parsed.length).toBe(1);
      const res = parsed[0];
      expect(res !== undefined).toBeTrue();
      if (res !== undefined) {
        expect(res.role).toBe("orchestrator");
        expect(res.pid).toBe(12345);
        expect(res.ppid).toBe(12344);
        expect(res.agent_id).toBe("agent-orch-01");
        expect(res.context?.cwd).toBe("/path/to/repo");
        expect(res.context?.indicators?.INTERACTIVE).toBe("1");
      }
    });

    test("round-trips entries via serializeBlunderLog without data loss", () => {
      const entries: BlunderEntry[] = [
        {
          id: "rt-1",
          type: "role_escalation",
          severity: "high",
          timestamp: "2026-08-22T06:00:00.000Z",
          category: "boundary_violation",
          status: "open",
          observation: "Direct file write",
          remediation: "Delegate to worker",
          role: "coordinator",
          message: "Direct file write",
          prescribed_remediation: "Delegate to worker",
          pid: 999,
          ppid: 888,
          agent_id: "agent-coord",
        },
      ];

      const serialized = serializeBlunderLog(entries);
      const reparsed = parseBlunderLog(serialized);

      expect(reparsed.length).toBe(1);
      expect(reparsed[0]?.id).toBe("rt-1");
      expect(reparsed[0]?.role).toBe("coordinator");
      expect(reparsed[0]?.severity).toBe("high");
      expect(reparsed[0]?.category).toBe("boundary_violation");
      expect(reparsed[0]?.pid).toBe(999);
    });
  });
});
