import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHostIdentity } from "../../../orchestrating-long-tasks/scripts/src/summary/host-telemetry.ts";

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
});
