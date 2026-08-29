import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  CANONICAL_HOST_TYPES,
  detectActiveHost,
  isHostType,
} from "../../../olt/scripts/src/platform/index.ts";

describe("CANONICAL_HOST_TYPES and isHostType", () => {
  test("CANONICAL_HOST_TYPES contains exact 4 canonical host types in expected order", () => {
    expect(CANONICAL_HOST_TYPES).toEqual(["antigravity", "claude_code", "codex", "cursor"]);
    expect(CANONICAL_HOST_TYPES.length).toBe(4);
  });

  test("isHostType returns true for all canonical host types", () => {
    for (const host of CANONICAL_HOST_TYPES) {
      expect(isHostType(host)).toBe(true);
    }
  });

  test("isHostType returns false for non-canonical strings and non-string values", () => {
    expect(isHostType("chatgpt")).toBe(false);
    expect(isHostType("claude-code")).toBe(false);
    expect(isHostType("vscode")).toBe(false);
    expect(isHostType("")).toBe(false);
    expect(isHostType(null)).toBe(false);
    expect(isHostType(undefined)).toBe(false);
    expect(isHostType(123)).toBe(false);
    expect(isHostType({})).toBe(false);
    expect(isHostType(["antigravity"])).toBe(false);
    expect(isHostType(true)).toBe(false);
  });
});

describe("detectActiveHost", () => {
  describe("antigravity detection", () => {
    test("detects antigravity via ANTIGRAVITY_APP_DIR", () => {
      expect(detectActiveHost({ ANTIGRAVITY_APP_DIR: "/app/data" })).toBe("antigravity");
    });

    test("detects antigravity via GEMINI_CLI_HOME", () => {
      expect(detectActiveHost({ GEMINI_CLI_HOME: "/gemini/home" })).toBe("antigravity");
    });

    test("detects antigravity when both ANTIGRAVITY_APP_DIR and GEMINI_CLI_HOME are set", () => {
      expect(
        detectActiveHost({
          ANTIGRAVITY_APP_DIR: "/app/data",
          GEMINI_CLI_HOME: "/gemini/home",
        }),
      ).toBe("antigravity");
    });
  });

  describe("claude_code detection", () => {
    test("detects claude_code via CLAUDE_PROJECT_DIR", () => {
      expect(detectActiveHost({ CLAUDE_PROJECT_DIR: "/project" })).toBe("claude_code");
    });

    test("detects claude_code via CLAUDE_CODE_ENTRY", () => {
      expect(detectActiveHost({ CLAUDE_CODE_ENTRY: "1" })).toBe("claude_code");
    });

    test("detects claude_code when both CLAUDE_PROJECT_DIR and CLAUDE_CODE_ENTRY are set", () => {
      expect(
        detectActiveHost({
          CLAUDE_PROJECT_DIR: "/project",
          CLAUDE_CODE_ENTRY: "cli",
        }),
      ).toBe("claude_code");
    });
  });

  describe("codex detection", () => {
    test("detects codex via CODEX_RUNTIME", () => {
      expect(detectActiveHost({ CODEX_RUNTIME: "codex-core" })).toBe("codex");
    });

    test("detects codex via CODEX_THREAD_ID", () => {
      expect(detectActiveHost({ CODEX_THREAD_ID: "th-12345" })).toBe("codex");
    });

    test("detects codex when both CODEX_RUNTIME and CODEX_THREAD_ID are set", () => {
      expect(
        detectActiveHost({
          CODEX_RUNTIME: "1",
          CODEX_THREAD_ID: "th-999",
        }),
      ).toBe("codex");
    });
  });

  describe("cursor detection", () => {
    test("detects cursor via CURSOR_PROJECT_DIR", () => {
      expect(detectActiveHost({ CURSOR_PROJECT_DIR: "/workspace" })).toBe("cursor");
    });

    test("detects cursor via CURSOR_TRACE_ID", () => {
      expect(detectActiveHost({ CURSOR_TRACE_ID: "tr-abcdef" })).toBe("cursor");
    });

    test("detects cursor when both CURSOR_PROJECT_DIR and CURSOR_TRACE_ID are set", () => {
      expect(
        detectActiveHost({
          CURSOR_PROJECT_DIR: "/workspace",
          CURSOR_TRACE_ID: "tr-123",
        }),
      ).toBe("cursor");
    });
  });

  describe("precedence ordering", () => {
    test("antigravity takes precedence over claude_code, codex, and cursor", () => {
      expect(
        detectActiveHost({
          ANTIGRAVITY_APP_DIR: "/app",
          CLAUDE_PROJECT_DIR: "/claude",
          CODEX_RUNTIME: "1",
          CURSOR_PROJECT_DIR: "/cursor",
        }),
      ).toBe("antigravity");
    });

    test("claude_code takes precedence over codex and cursor", () => {
      expect(
        detectActiveHost({
          CLAUDE_CODE_ENTRY: "1",
          CODEX_THREAD_ID: "th-1",
          CURSOR_TRACE_ID: "tr-1",
        }),
      ).toBe("claude_code");
    });

    test("codex takes precedence over cursor", () => {
      expect(
        detectActiveHost({
          CODEX_RUNTIME: "1",
          CURSOR_PROJECT_DIR: "/cursor",
        }),
      ).toBe("codex");
    });
  });

  describe("fail-closed unsupported host behavior", () => {
    test("throws HarnessError with code UNSUPPORTED_HOST when environment is empty", () => {
      expect(() => detectActiveHost({})).toThrow(HarnessError);
      try {
        detectActiveHost({});
        expect.unreachable("expected detectActiveHost to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(HarnessError);
        const harnessError = error as HarnessError;
        expect(harnessError.code).toBe("UNSUPPORTED_HOST");
        expect(harnessError.message).toBe(
          "Could not detect canonical host environment (zero generic fallback)",
        );
      }
    });

    test("throws HarnessError when environment contains only unrelated variables", () => {
      expect(() =>
        detectActiveHost({
          NODE_ENV: "production",
          PATH: "/usr/bin:/bin",
          HOME: "/home/user",
          USER: "developer",
        }),
      ).toThrow(HarnessError);
    });

    test("throws HarnessError when host environment variables are empty strings", () => {
      expect(() =>
        detectActiveHost({
          ANTIGRAVITY_APP_DIR: "",
          GEMINI_CLI_HOME: "",
          CLAUDE_PROJECT_DIR: "",
          CLAUDE_CODE_ENTRY: "",
          CODEX_RUNTIME: "",
          CODEX_THREAD_ID: "",
          CURSOR_PROJECT_DIR: "",
          CURSOR_TRACE_ID: "",
        }),
      ).toThrow(HarnessError);
    });

    test("throws HarnessError when host environment variables are undefined", () => {
      expect(() =>
        detectActiveHost({
          ANTIGRAVITY_APP_DIR: undefined,
          GEMINI_CLI_HOME: undefined,
          CLAUDE_PROJECT_DIR: undefined,
          CLAUDE_CODE_ENTRY: undefined,
          CODEX_RUNTIME: undefined,
          CODEX_THREAD_ID: undefined,
          CURSOR_PROJECT_DIR: undefined,
          CURSOR_TRACE_ID: undefined,
        }),
      ).toThrow(HarnessError);
    });

    test("detectActiveHost defaults to process.env without throwing if process.env matches a host", () => {
      // In this environment, either process.env detects a host or throws HarnessError (fail-closed)
      try {
        const detected = detectActiveHost();
        expect(isHostType(detected)).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).code).toBe("UNSUPPORTED_HOST");
      }
    });
  });
});
