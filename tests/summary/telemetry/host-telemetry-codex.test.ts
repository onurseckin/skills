import { beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectHostIdentity,
  detectHostTelemetry,
} from "../../../olt/scripts/src/summary/metrics/index.ts";
import { setupVirtualSummaryFS } from "../fixture.ts";

const HOST_MODEL_VARIABLE = "CLAUDE_CODE_MODEL";

let rootCounter = 0;

beforeEach(() => {
  setupVirtualSummaryFS();
});

function withTempHome(fn: (home: string) => void): void {
  rootCounter += 1;
  const tempHome = `/virtual/telemetry-codex-test-${rootCounter}`;
  fs.mkdirSync(tempHome, { recursive: true });
  fn(tempHome);
}

function writeHostSettings(home: string, settings: unknown): void {
  const dir = join(home, ".gemini", "antigravity-cli");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
}

describe("host identity detection", () => {
  test("names the harness the capsule was exported under", () => {
    withTempHome((home) => {
      writeHostSettings(home, { model: "Gemini 3.7 Flash (High)" });
      expect(detectHostIdentity({ homeDir: home, env: {} })).toEqual({
        hostTool: "antigravity",
        evidenceClass: "harness_observed",
      });
    });
  });

  test("never reports a model, because the machine's config is not an agent's telemetry", () => {
    withTempHome((home) => {
      writeHostSettings(home, { model: "Gemini 3.7 Flash (High)", thinkingLevel: "high" });
      const identity = detectHostIdentity({ homeDir: home, env: {} });
      expect(Object.keys(identity ?? {}).sort()).toEqual(["evidenceClass", "hostTool"]);
      expect(JSON.stringify(identity)).not.toContain("Gemini");
    });
  });

  test("recognises the claude-code, cursor and custom hosts", () => {
    withTempHome((home) => {
      expect(
        detectHostIdentity({ homeDir: home, env: { [HOST_MODEL_VARIABLE]: "claude-3-7-sonnet" } })
          ?.hostTool,
      ).toBe("claude-code");
      writeFileSync(join(home, ".claude.json"), JSON.stringify({ currentModel: "claude-3-5" }));
      expect(detectHostIdentity({ homeDir: home, env: {} })?.hostTool).toBe("claude-code");
      expect(detectHostIdentity({ homeDir: home, env: { CURSOR_MODEL: "gpt-4o" } })?.hostTool).toBe(
        "claude-code",
      );
    });
    withTempHome((home) => {
      expect(detectHostIdentity({ homeDir: home, env: { CURSOR_MODEL: "gpt-4o" } })?.hostTool).toBe(
        "cursor",
      );
      expect(detectHostIdentity({ homeDir: home, env: { AI_MODEL: "in-house" } })?.hostTool).toBe(
        "custom",
      );
    });
  });

  test("returns null when nothing on the machine identifies a host", () => {
    withTempHome((home) => {
      expect(detectHostIdentity({ homeDir: home, env: {} })).toBeNull();
    });
    expect(
      detectHostIdentity({
        homeDir: "/non/existent/path/for/hermetic/testing",
        env: { HOME: "", USERPROFILE: "", CURSOR_MODEL: "", MODEL: "  " },
      }),
    ).toBeNull();
  });

  test("treats a corrupt or empty config as no identity at all", () => {
    for (const content of ["invalid-json {{{", "", "   \n\t ", JSON.stringify({ model: "  " })]) {
      withTempHome((home) => {
        const dir = join(home, ".gemini", "antigravity-cli");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "settings.json"), content);
        expect(detectHostIdentity({ homeDir: home, env: {} })).toBeNull();
      });
    }
  });

  test("recognises codex from a config.toml that carries no plain string value", () => {
    withTempHome((home) => {
      const dir = join(home, ".codex");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "config.toml"), "[agents]\nmax_concurrent_threads_per_session = 4\n");
      expect(detectHostIdentity({ homeDir: home, env: {} })?.hostTool).toBe("codex");
    });
  });

  test("treats a config.toml that fails to parse as no identity at all", () => {
    withTempHome((home) => {
      const dir = join(home, ".codex");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "config.toml"), "[agents\nmax_concurrent_threads_per_session = 4\n");
      expect(detectHostIdentity({ homeDir: home, env: {} })).toBeNull();
    });
  });

  test("falls back to $USERPROFILE when $HOME is unset, as on Windows", () => {
    withTempHome((home) => {
      writeHostSettings(home, { model: "Gemini 3.7 Flash (High)" });
      expect(detectHostIdentity({ env: { USERPROFILE: home } })?.hostTool).toBe("antigravity");
    });
  });

  test("falls back to the OS-reported home directory when neither env var is set", () => {
    expect(detectHostIdentity({ env: { CLAUDE_CODE_SESSION_ID: "sess-1" } })).toEqual({
      hostTool: "claude-code",
      evidenceClass: "harness_observed",
    });
  });

  test("a config path that is a directory, not a file, is read as absent rather than throwing", () => {
    withTempHome((home) => {
      mkdirSync(join(home, ".gemini", "antigravity-cli", "settings.json"), { recursive: true });
      expect(detectHostIdentity({ homeDir: home, env: {} })).toBeNull();
    });
  });
});

describe("host telemetry probing: codex", () => {
  test("codex: reads the session concurrency ceiling and the multi_agent feature flag", () => {
    withTempHome((home) => {
      const dir = join(home, ".codex");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "config.toml"),
        "[agents]\nmax_concurrent_threads_per_session = 4\n\n[features]\nmulti_agent = true\n",
      );
      const probe = detectHostTelemetry("worker-1", { homeDir: home, env: {} });
      expect(probe?.host_tool).toBe("codex");
      expect(probe?.capabilities.concurrency_ceiling).toEqual({
        value: 4,
        evidence_class: "derived",
      });
      expect(probe?.capabilities.multi_agent_enabled).toEqual({
        value: true,
        evidence_class: "derived",
      });
      expect(probe?.capabilities.native_resume).toEqual({ value: true, evidence_class: "derived" });
      expect(probe?.capabilities.per_agent_model_selection).toEqual({
        value: true,
        evidence_class: "derived",
      });
    });
  });

  test("codex: reads a per-agent model and reasoning effort keyed by the exact agent id", () => {
    withTempHome((home) => {
      const agentsDir = join(home, ".codex", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(home, ".codex", "config.toml"), "[features]\nmulti_agent = true\n");
      writeFileSync(
        join(agentsDir, "worker-7.toml"),
        'model = "gpt-codex-mini"\nreasoning_effort = "high"\n',
      );

      const other = detectHostTelemetry("worker-1", { homeDir: home, env: {} });
      expect(other?.model).toBeUndefined();
      expect(other?.thinking_level).toBeUndefined();

      const probe = detectHostTelemetry("worker-7", { homeDir: home, env: {} });
      expect(probe?.model).toEqual({ value: "gpt-codex-mini", evidence_class: "derived" });
      expect(probe?.thinking_level).toEqual({ value: "high", evidence_class: "derived" });
    });
  });

  test("codex: an unrecognised reasoning effort is left absent rather than guessed at", () => {
    withTempHome((home) => {
      const agentsDir = join(home, ".codex", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(home, ".codex", "config.toml"), "[features]\nmulti_agent = false\n");
      writeFileSync(join(agentsDir, "worker-1.toml"), 'reasoning_effort = "extreme"\n');
      expect(
        detectHostTelemetry("worker-1", { homeDir: home, env: {} })?.thinking_level,
      ).toBeUndefined();
    });
  });
});
