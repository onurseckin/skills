import { beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectHostTelemetry } from "../../../olt/scripts/src/summary/metrics/index.ts";
import { setupVirtualSummaryFS } from "../fixture.ts";

const HOST_MODEL_VARIABLE = "CLAUDE_CODE_MODEL";

let rootCounter = 0;

beforeEach(() => {
  setupVirtualSummaryFS();
});

function withTempHome(fn: (home: string) => void): void {
  rootCounter += 1;
  const tempHome = `/virtual/telemetry-claude-test-${rootCounter}`;
  fs.mkdirSync(tempHome, { recursive: true });
  fn(tempHome);
}

function writeHostSettings(home: string, settings: unknown): void {
  const dir = join(home, ".gemini", "antigravity-cli");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
}

describe("host telemetry probing: claude-code, antigravity, cursor", () => {
  test("claude-code: nesting depth and concurrency are read only when the host actually set them", () => {
    withTempHome((home) => {
      const unset = detectHostTelemetry("worker-1", {
        homeDir: home,
        env: { [HOST_MODEL_VARIABLE]: "claude-3-7-sonnet" },
      });
      expect(unset?.capabilities.nesting_depth).toBeUndefined();
      expect(unset?.capabilities.concurrency_ceiling).toBeUndefined();
      expect(unset?.capabilities.per_agent_model_selection).toEqual({
        value: true,
        evidence_class: "derived",
      });

      const set = detectHostTelemetry("worker-1", {
        homeDir: home,
        env: {
          [HOST_MODEL_VARIABLE]: "claude-3-7-sonnet",
          CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "3",
          CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "20",
        },
      });
      expect(set?.capabilities.nesting_depth).toEqual({ value: 3, evidence_class: "derived" });
      expect(set?.capabilities.concurrency_ceiling).toEqual({
        value: 20,
        evidence_class: "derived",
      });
    });
  });

  test("claude-code: reads the current project's last model usage, keyed by its exact cwd", () => {
    withTempHome((home) => {
      writeFileSync(
        join(home, ".claude.json"),
        JSON.stringify({
          projects: {
            "/repo/one": { lastModelUsage: { "claude-sonnet-5": { total_tokens: 42 } } },
            "/repo/two": { lastModelUsage: {} },
          },
        }),
      );

      const matched = detectHostTelemetry("worker-1", {
        homeDir: home,
        env: { [HOST_MODEL_VARIABLE]: "claude-3-7-sonnet" },
        cwd: "/repo/one",
      });
      expect(matched?.last_model_usage).toEqual({
        value: { "claude-sonnet-5": { total_tokens: 42 } },
        evidence_class: "derived",
      });

      const empty = detectHostTelemetry("worker-1", {
        homeDir: home,
        env: { [HOST_MODEL_VARIABLE]: "claude-3-7-sonnet" },
        cwd: "/repo/two",
      });
      expect(empty?.last_model_usage).toBeUndefined();

      const unknownCwd = detectHostTelemetry("worker-1", {
        homeDir: home,
        env: { [HOST_MODEL_VARIABLE]: "claude-3-7-sonnet" },
        cwd: "/repo/three",
      });
      expect(unknownCwd?.last_model_usage).toBeUndefined();
    });
  });

  test("claude-code: a .claude.json whose projects field is not an object is read as no usage", () => {
    withTempHome((home) => {
      writeFileSync(join(home, ".claude.json"), JSON.stringify({ projects: "not-an-object" }));
      const probe = detectHostTelemetry("worker-1", {
        homeDir: home,
        env: { [HOST_MODEL_VARIABLE]: "claude-3-7-sonnet" },
        cwd: "/repo/one",
      });
      expect(probe?.last_model_usage).toBeUndefined();
    });
  });

  test("antigravity and cursor report only their documented capabilities, nothing invented", () => {
    withTempHome((home) => {
      writeHostSettings(home, { model: "Gemini 3.7 Flash (High)" });
      const probe = detectHostTelemetry("worker-1", { homeDir: home, env: {} });
      expect(probe?.capabilities.native_workspace_isolation).toEqual({
        value: true,
        evidence_class: "derived",
      });
      expect(probe?.capabilities.native_resume).toEqual({ value: true, evidence_class: "derived" });
      expect(probe?.capabilities.nesting_depth).toBeUndefined();
      expect(probe?.capabilities.concurrency_ceiling).toBeUndefined();
    });
    withTempHome((home) => {
      const probe = detectHostTelemetry("worker-1", {
        homeDir: home,
        env: { CURSOR_MODEL: "gpt-4o" },
      });
      expect(probe?.capabilities.nesting_depth).toEqual({ value: 2, evidence_class: "derived" });
      expect(probe?.capabilities.concurrency_ceiling).toBeUndefined();
    });
  });

  test("no identified host means no telemetry at all", () => {
    withTempHome((home) => {
      expect(detectHostTelemetry("worker-1", { homeDir: home, env: {} })).toBeNull();
    });
    withTempHome((home) => {
      expect(
        detectHostTelemetry("worker-1", { homeDir: home, env: { AI_MODEL: "in-house" } }),
      ).toBeNull();
    });
  });
});
