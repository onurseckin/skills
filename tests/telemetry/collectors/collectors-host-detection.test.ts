import { describe, expect, it } from "bun:test";
import {
  canonicalHostToPlatformId,
  detectActiveHost,
  detectHostFromEnvironment,
  detectHostFromModel,
  detectHostFromProcessTree,
  detectHostFromTerminal,
  isCanonicalHost,
  isPlatformMatchingHost,
  normalizeHostName,
  platformIdToCanonicalHost,
} from "../../../olt/scripts/src/telemetry/collectors/index.ts";

describe("Active Host Detection & Isolation", () => {
  describe("detectHostFromEnvironment", () => {
    it("detects antigravity from primary environment variables", () => {
      const sig1 = detectHostFromEnvironment({ ANTIGRAVITY_APP_DIR: "/app/dir" });
      expect(sig1?.host).toBe("antigravity");
      expect(sig1?.confidence).toBe("verified_exact");
      expect(sig1?.mechanism).toBe("environment");

      const sig2 = detectHostFromEnvironment({ GEMINI_CLI_HOME: "/home/gemini" });
      expect(sig2?.host).toBe("antigravity");
      expect(sig2?.confidence).toBe("verified_exact");
    });

    it("detects claude_code from primary environment variables", () => {
      const sig1 = detectHostFromEnvironment({ CLAUDE_PROJECT_DIR: "/proj" });
      expect(sig1?.host).toBe("claude_code");
      expect(sig1?.confidence).toBe("verified_exact");

      const sig2 = detectHostFromEnvironment({ CLAUDE_CODE_ENTRY: "/bin/claude" });
      expect(sig2?.host).toBe("claude_code");
      expect(sig2?.confidence).toBe("verified_exact");
    });

    it("detects codex from primary environment variables", () => {
      const sig1 = detectHostFromEnvironment({ CODEX_RUNTIME: "1" });
      expect(sig1?.host).toBe("codex");
      expect(sig1?.confidence).toBe("verified_exact");

      const sig2 = detectHostFromEnvironment({ CODEX_THREAD_ID: "th_123" });
      expect(sig2?.host).toBe("codex");
      expect(sig2?.confidence).toBe("verified_exact");
    });

    it("detects cursor from primary environment variables", () => {
      const sig1 = detectHostFromEnvironment({ CURSOR_PROJECT_DIR: "/cursor/proj" });
      expect(sig1?.host).toBe("cursor");
      expect(sig1?.confidence).toBe("verified_exact");

      const sig2 = detectHostFromEnvironment({ CURSOR_TRACE_ID: "trace_abc" });
      expect(sig2?.host).toBe("cursor");
      expect(sig2?.confidence).toBe("verified_exact");
    });

    it("detects hosts from secondary inferred environment variables", () => {
      expect(detectHostFromEnvironment({ ANTIGRAVITY_VERSION: "1.0.0" })?.host).toBe("antigravity");
      expect(detectHostFromEnvironment({ CLAUDE_CODE_VERSION: "2.1.0" })?.host).toBe("claude_code");
      expect(detectHostFromEnvironment({ CODEX_VERSION: "0.9.0" })?.host).toBe("codex");
      expect(detectHostFromEnvironment({ OPENCODE_CLI: "1" })?.host).toBe("codex");
      expect(detectHostFromEnvironment({ CURSOR_CHANNEL: "nightly" })?.host).toBe("cursor");
    });

    it("handles explicit environment host overrides", () => {
      const sig = detectHostFromEnvironment({ OVERRIDE_HOST: "codex" });
      expect(sig?.host).toBe("codex");
      expect(sig?.mechanism).toBe("explicit_override");
    });

    it("returns null when no matching environment variables exist", () => {
      expect(detectHostFromEnvironment({})).toBeNull();
    });
  });

  describe("detectHostFromProcessTree", () => {
    it("detects antigravity from process tree tokens", () => {
      const sig = detectHostFromProcessTree(["zsh", "agy", "bun"]);
      expect(sig?.host).toBe("antigravity");
      expect(sig?.confidence).toBe("inferred");
    });

    it("detects claude_code from process tree tokens", () => {
      const sig = detectHostFromProcessTree("node -> claude-code -> bun");
      expect(sig?.host).toBe("claude_code");
    });

    it("detects codex from process tree tokens", () => {
      const sig = detectHostFromProcessTree(["bash", "codex", "worker"]);
      expect(sig?.host).toBe("codex");
    });

    it("detects cursor from process tree tokens", () => {
      const sig = detectHostFromProcessTree("cursor -> zsh -> bun");
      expect(sig?.host).toBe("cursor");
    });

    it("returns null for non-matching process tree", () => {
      expect(detectHostFromProcessTree(["init", "systemd"])).toBeNull();
    });
  });

  describe("detectHostFromModel", () => {
    it("maps Gemini models to antigravity", () => {
      expect(detectHostFromModel("gemini-3.7-flash-high")?.host).toBe("antigravity");
      expect(detectHostFromModel("gemini-1.5-pro")?.host).toBe("antigravity");
    });

    it("maps Claude models to claude_code", () => {
      expect(detectHostFromModel("claude-sonnet-4-6")?.host).toBe("claude_code");
      expect(detectHostFromModel("claude-3-5-sonnet")?.host).toBe("claude_code");
    });

    it("maps OpenAI / Codex models to codex", () => {
      expect(detectHostFromModel("o3-mini")?.host).toBe("codex");
      expect(detectHostFromModel("o1-preview")?.host).toBe("codex");
      expect(detectHostFromModel("gpt-4o")?.host).toBe("codex");
      expect(detectHostFromModel("gpt-5-preview")?.host).toBe("codex");
      expect(detectHostFromModel("codex-davinci")?.host).toBe("codex");
    });

    it("maps Cursor models to cursor", () => {
      expect(detectHostFromModel("cursor-fast")?.host).toBe("cursor");
    });

    it("returns null for unmapped models", () => {
      expect(detectHostFromModel("llama-3-70b")).toBeNull();
      expect(detectHostFromModel("")).toBeNull();
    });
  });

  describe("detectHostFromTerminal", () => {
    it("detects cursor terminal from TERM_PROGRAM", () => {
      const sig = detectHostFromTerminal({ TERM_PROGRAM: "cursor" });
      expect(sig?.host).toBe("cursor");
      expect(sig?.confidence).toBe("heuristic");
    });
  });

  describe("detectActiveHost integration and precedence", () => {
    it("prioritizes explicit host over environment", () => {
      const res = detectActiveHost({
        explicitHost: "codex",
        env: { ANTIGRAVITY_APP_DIR: "/app" },
      });
      expect(res.activeHost).toBe("codex");
      expect(res.signal.mechanism).toBe("explicit_override");
    });

    it("prioritizes environment over process tree", () => {
      const res = detectActiveHost({
        env: { CLAUDE_PROJECT_DIR: "/proj" },
        processTree: ["agy", "bun"],
      });
      expect(res.activeHost).toBe("claude_code");
      expect(res.signal.mechanism).toBe("environment");
    });

    it("prioritizes process tree over model", () => {
      const res = detectActiveHost({
        processTree: ["cursor", "bun"],
        model: "gemini-3.7-flash",
      });
      expect(res.activeHost).toBe("cursor");
      expect(res.signal.mechanism).toBe("process_tree");
    });

    it("falls back to antigravity heuristic when no signature is matched", () => {
      const res = detectActiveHost({ env: {} });
      expect(res.activeHost).toBe("antigravity");
      expect(res.isFallback).toBe(true);
    });
  });

  describe("Canonical host helper utilities", () => {
    it("validates canonical hosts", () => {
      expect(isCanonicalHost("antigravity")).toBe(true);
      expect(isCanonicalHost("claude_code")).toBe(true);
      expect(isCanonicalHost("codex")).toBe(true);
      expect(isCanonicalHost("cursor")).toBe(true);
      expect(isCanonicalHost("vscode")).toBe(false);
    });

    it("normalizes diverse host representations", () => {
      expect(normalizeHostName("agy")).toBe("antigravity");
      expect(normalizeHostName("claude")).toBe("claude_code");
      expect(normalizeHostName("claude-code")).toBe("claude_code");
      expect(normalizeHostName("openai")).toBe("codex");
      expect(normalizeHostName("opencode")).toBe("codex");
      expect(normalizeHostName("cursor_agent")).toBe("cursor");
      expect(normalizeHostName("unknown")).toBeNull();
    });

    it("maps canonical hosts to primary platform IDs", () => {
      expect(canonicalHostToPlatformId("antigravity")).toBe("antigravity");
      expect(canonicalHostToPlatformId("claude_code")).toBe("claude");
      expect(canonicalHostToPlatformId("codex")).toBe("codex");
      expect(canonicalHostToPlatformId("cursor")).toBe("cursor");
      expect(platformIdToCanonicalHost("claude")).toBe("claude_code");
    });

    it("correctly matches platforms to canonical hosts", () => {
      expect(isPlatformMatchingHost("antigravity", "antigravity")).toBe(true);
      expect(isPlatformMatchingHost("claude", "claude_code")).toBe(true);
      expect(isPlatformMatchingHost("codex", "codex")).toBe(true);
      expect(isPlatformMatchingHost("openai", "codex")).toBe(true);
      expect(isPlatformMatchingHost("cursor", "cursor")).toBe(true);
      expect(isPlatformMatchingHost("claude", "antigravity")).toBe(false);
    });
  });
});
