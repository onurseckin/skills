import { describe, expect, test } from "bun:test";
import { outputEvidenceIssues } from "../../../olt/scripts/src/engine/runner/receipt/output-evidence.ts";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("test output evidence", () => {
  test.each([
    [["go", "test", "./..."], "? module/package [no test files]"],
    [["cargo", "test", "--workspace"], "running 0 tests"],
    [["cargo", "test", "--workspace"], "test result: ok. 0 passed; 0 failed"],
    [["dotnet", "test"], "No test is available in build/output.dll"],
    [["bun", "run", "test"], "No tests found"],
    [["node", "--test"], "# tests 0"],
    [["env", "bun", "run", "test"], "No tests found"],
    [["env", "command", "go", "test", "./..."], "? module/package [no test files]"],
  ])("recognizes zero-test output for %s", (argv, output) => {
    expect(outputEvidenceIssues(argv, bytes(output), bytes(""))).toEqual([
      "test command discovered zero tests",
    ]);
  });

  test("does not classify test-like prose from a non-test command", () => {
    expect(
      outputEvidenceIssues(["echo", "status"], bytes("no tests found"), bytes("running 0 tests")),
    ).toEqual([]);
    expect(
      outputEvidenceIssues(["bun", "run", "build"], bytes("No test is available"), bytes("")),
    ).toEqual([]);
  });

  test("does not reject a mixed Cargo run with a zero-test phase and substantive tests", () => {
    const output = [
      "running 0 tests",
      "test result: ok. 0 passed; 0 failed; 0 ignored",
      "running 2 tests",
      "test result: ok. 2 passed; 0 failed; 0 ignored",
    ].join("\n");
    expect(
      outputEvidenceIssues(["cargo", "test", "--workspace"], bytes(output), bytes("")),
    ).toEqual([]);
  });

  test("classifies complete bounded streams rather than an output tail", () => {
    const stdout = bytes(`filters did not match any test files\n${"x".repeat(16_384)}`);
    expect(
      outputEvidenceIssues(
        ["bun", "test", "tests/runner/receipt/output-evidence.test.ts"],
        stdout,
        bytes(""),
      ),
    ).toEqual(["test command discovered zero tests"]);
  });
});
