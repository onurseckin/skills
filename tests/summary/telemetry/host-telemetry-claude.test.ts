import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectHostTelemetry } from "../../../olt/scripts/src/summary/metrics/index.ts";

const HOST_MODEL_VARIABLE = "CLAUDE_CODE_MODEL";

const vfs = new Map<string, string>();
let rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];
const norm = (p: fs.PathLike) => resolve(String(p)).replace(/\/+$/, "");

beforeEach(() => {
  const oe = fs.existsSync.bind(fs),
    or = fs.readFileSync.bind(fs),
    ow = fs.writeFileSync.bind(fs);
  const om = fs.mkdirSync.bind(fs),
    orm = fs.rmSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = norm(p);
      return s.startsWith("/virtual/")
        ? vfs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`))
        : oe(p);
    }),
    spyOn(fs, "readFileSync").mockImplementation((p, opt) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const c = vfs.get(s);
        if (!c) throw new Error(`ENOENT: ${s}`);
        return opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt)
          ? c
          : Buffer.from(c, "utf-8");
      }
      return or(p, opt as Parameters<typeof or>[1]);
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.set(
          s,
          typeof d === "string"
            ? d
            : Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString("utf-8"),
        );
        return;
      }
      ow(p, d);
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) =>
      norm(p).startsWith("/virtual/") ? undefined : (om(p) as string | undefined),
    ),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.delete(s);
        for (const k of Array.from(vfs.keys())) if (k.startsWith(`${s}/`)) vfs.delete(k);
        return;
      }
      orm(p, { recursive: true, force: true });
    }),
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
});

function withTempHome(fn: (home: string) => void): void {
  rootCounter += 1;
  const tempHome = `/virtual/telemetry-claude-test-${rootCounter}`;
  fn(tempHome);
}

function writeHostSettings(home: string, settings: unknown): void {
  vfs.set(join(home, ".gemini", "antigravity-cli", "settings.json"), JSON.stringify(settings));
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
