import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractErrorCode,
  extractErrorMessage,
  logCliDefect,
  main,
  mapCategoryFromErrorCode,
  mapSeverityFromErrorCode,
} from "../olt/scripts/harness.ts";
import { HarnessError } from "../olt/scripts/src/core/errors/harness-error.ts";
import { findRepoRoot } from "../olt/scripts/src/core/shared/paths.ts";

interface DefectEntryRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly category: string;
  readonly command: string;
  readonly error_code: string;
  readonly message: string;
  readonly severity: string;
  readonly status?: string;
}

describe("Wave 3 Task 6: Automatic Defect Logging & Telemetry", () => {
  const repoRoot = findRepoRoot();
  const defectsPath = join(repoRoot, ".olt", "defects.jsonl");
  let originalDefectsContent = "";

  beforeEach(() => {
    if (existsSync(defectsPath)) {
      originalDefectsContent = readFileSync(defectsPath, "utf-8");
    } else {
      originalDefectsContent = "";
    }
  });

  afterEach(() => {
    if (originalDefectsContent) {
      writeFileSync(defectsPath, originalDefectsContent, "utf-8");
    } else if (existsSync(defectsPath)) {
      writeFileSync(defectsPath, "", "utf-8");
    }
  });

  test("mapCategoryFromErrorCode correctly maps categories", () => {
    expect(mapCategoryFromErrorCode("INVALID_STATE")).toBe("state_conflict");
    expect(mapCategoryFromErrorCode("LOCK_TIMEOUT")).toBe("state_conflict");
    expect(mapCategoryFromErrorCode("INTEGRITY")).toBe("state_conflict");
    expect(mapCategoryFromErrorCode("PERMISSION_DENIED")).toBe("permission_denied");
    expect(mapCategoryFromErrorCode("AUTHENTICATION_FAILURE")).toBe("permission_denied");
    expect(mapCategoryFromErrorCode("ROLE_CONFINEMENT_VIOLATION")).toBe("permission_denied");
    expect(mapCategoryFromErrorCode("ROLE_BOUNDARY_DEVIATION")).toBe("permission_denied");
    expect(mapCategoryFromErrorCode("INVALID_ARGUMENT")).toBe("cli_error");
    expect(mapCategoryFromErrorCode("UNHANDLED_ERROR")).toBe("cli_error");
    expect(mapCategoryFromErrorCode("UNKNOWN_CODE")).toBe("cli_error");
  });

  test("mapSeverityFromErrorCode maps critical vs important", () => {
    expect(mapSeverityFromErrorCode("PERMISSION_DENIED")).toBe("critical");
    expect(mapSeverityFromErrorCode("AUTHENTICATION_FAILURE")).toBe("critical");
    expect(mapSeverityFromErrorCode("ROLE_CONFINEMENT_VIOLATION")).toBe("critical");
    expect(mapSeverityFromErrorCode("INTEGRITY")).toBe("critical");
    expect(mapSeverityFromErrorCode("UNHANDLED_ERROR")).toBe("critical");
    expect(mapSeverityFromErrorCode("INVALID_ARGUMENT")).toBe("important");
    expect(mapSeverityFromErrorCode("INVALID_STATE")).toBe("important");
  });

  test("extractErrorCode extracts from HarnessError, objects, and fallbacks", () => {
    expect(extractErrorCode(new HarnessError("INVALID_ARGUMENT", "bad arg"))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(extractErrorCode(new HarnessError("PERMISSION_DENIED", "denied"))).toBe(
      "PERMISSION_DENIED",
    );
    expect(extractErrorCode({ code: "CUSTOM_ERROR" })).toBe("CUSTOM_ERROR");
    expect(extractErrorCode(new Error("generic error"))).toBe("UNHANDLED_ERROR");
    expect(extractErrorCode("string error")).toBe("UNHANDLED_ERROR");
  });

  test("extractErrorMessage extracts message properly", () => {
    expect(extractErrorMessage(new Error("sample error message"))).toBe("sample error message");
    expect(extractErrorMessage({ message: "custom obj message" })).toBe("custom obj message");
    expect(extractErrorMessage("raw string")).toBe("raw string");
  });

  test("main records a defect to .olt/defects.jsonl when HarnessError occurs", async () => {
    const testArgv = ["nonexistent-cli-command-for-defect-test-1234"];
    await expect(main(testArgv)).rejects.toThrow();

    expect(existsSync(defectsPath)).toBe(true);
    const lines = readFileSync(defectsPath, "utf-8").trim().split("\n");
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toBeDefined();

    const record = JSON.parse(lastLine ?? "{}") as DefectEntryRecord;
    expect(record.command).toBe("nonexistent-cli-command-for-defect-test-1234");
    expect(record.error_code).toBe("INVALID_ARGUMENT");
    expect(record.category).toBe("cli_error");
    expect(record.severity).toBe("important");
    expect(record.message).toContain("unknown command");
    expect(typeof record.timestamp).toBe("string");
    expect(Date.parse(record.timestamp)).not.toBeNaN();
  });

  test("logCliDefect directly logs a defect with all mandatory fields", () => {
    const err = new HarnessError("ROLE_CONFINEMENT_VIOLATION", "Agent broke confinement boundary");
    const argv = ["harness:command", "--role", "worker"];
    logCliDefect(err, argv);

    const lines = readFileSync(defectsPath, "utf-8").trim().split("\n");
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toBeDefined();

    const record = JSON.parse(lastLine ?? "{}") as DefectEntryRecord;
    expect(record.command).toBe("harness:command --role worker");
    expect(record.error_code).toBe("ROLE_CONFINEMENT_VIOLATION");
    expect(record.category).toBe("permission_denied");
    expect(record.severity).toBe("critical");
    expect(record.message).toBe("Agent broke confinement boundary");
    expect(typeof record.timestamp).toBe("string");
  });

  test("CLI failure via subprocess captures defect to .olt/defects.jsonl", async () => {
    const testCmd = "subprocess-failure-test-command-xyz";
    const proc = Bun.spawn(["bun", "./olt/scripts/harness.ts", testCmd], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);

    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toContain("unknown command");

    const lines = readFileSync(defectsPath, "utf-8").trim().split("\n");
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toBeDefined();

    const record = JSON.parse(lastLine ?? "{}") as DefectEntryRecord;
    expect(record.command).toBe(testCmd);
    expect(record.error_code).toBe("INVALID_ARGUMENT");
    expect(record.category).toBe("cli_error");
    expect(record.severity).toBe("important");
  });

  test("defect logging is non-blocking and handles unexpected errors gracefully", () => {
    expect(() => {
      logCliDefect(null, ["test"]);
      logCliDefect(undefined, ["test"]);
      logCliDefect("primitive error string", ["test"]);
    }).not.toThrow();
  });
});
