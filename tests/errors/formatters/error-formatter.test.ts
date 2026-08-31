import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { formatCliError } from "../../../olt/scripts/src/cli/signals/error-propagation.ts";

describe("CLI Error Formatter", () => {
  it("formats CLI error in markdown format with fix", () => {
    const err = new HarnessError("PATH_SAFETY", "Unsafe path", [], 3, "Check sandbox directory");
    const formatted = formatCliError(err);
    expect(formatted).toContain("**Error (PATH_SAFETY)**");
    expect(formatted).toContain("Unsafe path");
    expect(formatted).toContain("> **Fix**: Check sandbox directory");
  });

  it("formats CLI error as JSON when requested", () => {
    const err = new HarnessError("INVALID_ARGUMENT", "Missing parameter");
    const jsonFormatted = formatCliError(err, { json: true });
    const parsed = JSON.parse(jsonFormatted);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  it("formats fatal internal standard errors", () => {
    const stdErr = new Error("Unexpected crash");
    const formatted = formatCliError(stdErr);
    expect(formatted).toContain("**Fatal Internal Error**: Unexpected crash");
  });
});
