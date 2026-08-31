import { describe, expect, test } from "bun:test";
import { basename } from "node:path";

export function sentinelCommandArgv(processArgv: readonly string[]): string[] {
  const separator = processArgv.indexOf("--");
  const forwarded = processArgv.slice(separator >= 0 ? separator + 1 : 2);
  if (forwarded[0] === "--") forwarded.shift();
  return forwarded.length >= 3 && basename(forwarded[0] ?? "") === "bun" && forwarded[1] === "test"
    ? forwarded
    : [];
}

describe("host-safety sentinel argv", () => {
  test("accepts both a preserved and Bun-consumed delimiter", () => {
    const command = ["bun", "test", "tests/runner/execution/attempt-terminal-proof.test.ts"];
    expect(sentinelCommandArgv(["bun", "launcher.ts", "--", ...command])).toEqual(command);
    expect(sentinelCommandArgv(["bun", "launcher.ts", ...command])).toEqual(command);
  });

  test("strips only one optional forwarded delimiter and rejects non-test commands", () => {
    const command = ["bun", "test", "tests/runner/execution/attempt-terminal-proof.test.ts"];
    expect(sentinelCommandArgv(["bun", "launcher.ts", "--", "--", ...command])).toEqual(command);
    expect(sentinelCommandArgv(["bun", "launcher.ts", "bun", "run", "build"])).toEqual([]);
  });
});
