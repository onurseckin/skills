import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectHostIdentity,
  detectHostTelemetry,
} from "../../olt/scripts/src/summary/metrics/index.ts";

// A host's own variable name, held as a value so no product names a symbol in this suite.
const HOST_MODEL_VARIABLE = "CLAUDE_CODE_MODEL";

function withTempHome(fn: (home: string) => void): void {
  const tempHome = mkdtempSync(join(tmpdir(), "telemetry-test-"));
  try {
    fn(tempHome);
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
}

function writeHostSettings(home: string, settings: unknown): void {
  const dir = join(home, ".gemini", "antigravity-cli");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
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
      // An unclosed table header: genuinely invalid TOML, not merely an odd-but-parseable shape.
      writeFileSync(join(dir, "config.toml"), "[agents\nmax_concurrent_threads_per_session = 4\n");
      expect(detectHostIdentity({ homeDir: home, env: {} })).toBeNull();
    });
  });

  test("falls back to $USERPROFILE when $HOME is unset, as on Windows", () => {
    withTempHome((home) => {
      writeHostSettings(home, { model: "Gemini 3.7 Flash (High)" });
      // No `homeDir` option and no HOME in this explicit env: only USERPROFILE names the machine's
      // home directory, the Windows convention resolveHomeDir falls back to.
      expect(detectHostIdentity({ env: { USERPROFILE: home } })?.hostTool).toBe("antigravity");
    });
  });

  test("falls back to the OS-reported home directory when neither env var is set", () => {
    // Every existing test above pins `homeDir` explicitly; none exercises the branch where
    // resolveHomeDir must call node:os's own homedir(). The session-id env var short-circuits
    // identity resolution regardless of what the real machine's homedir() returns, so this stays
    // deterministic while still exercising that fallback call.
    expect(detectHostIdentity({ env: { CLAUDE_CODE_SESSION_ID: "sess-1" } })).toEqual({
      hostTool: "claude-code",
      evidenceClass: "harness_observed",
    });
  });

  test("a config path that is a directory, not a file, is read as absent rather than throwing", () => {
    withTempHome((home) => {
      // existsSync is true for a directory too; readFileSync on it throws EISDIR, which is the
      // failure readConfig's own catch exists to absorb.
      mkdirSync(join(home, ".gemini", "antigravity-cli", "settings.json"), { recursive: true });
      expect(detectHostIdentity({ homeDir: home, env: {} })).toBeNull();
    });
  });
});

describe("host telemetry probing — the automatic, hardcoded half of the two sources", () => {
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

      // A different agent id has no file of its own — proving `agentId` is genuinely read, not
      // ignored: it changes which file gets opened, not just what gets logged.
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

      // An empty lastModelUsage object carries no evidence, so it is dropped rather than reported.
      const empty = detectHostTelemetry("worker-1", {
        homeDir: home,
        env: { [HOST_MODEL_VARIABLE]: "claude-3-7-sonnet" },
        cwd: "/repo/two",
      });
      expect(empty?.last_model_usage).toBeUndefined();

      // A cwd the projects map never recorded is absent, not an empty guess.
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
      // Neither is documented for Antigravity, so neither is reported.
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
