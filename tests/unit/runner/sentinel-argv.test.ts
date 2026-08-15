import { describe, expect, test } from "bun:test";
import { sentinelCommandArgv } from "./fixtures/sentinel-argv.ts";

describe("host-safety sentinel argv", () => {
  test("accepts both a preserved and Bun-consumed delimiter", () => {
    const command = ["bun", "test", "tests/unit/runner/execution.test.ts"];
    expect(sentinelCommandArgv(["bun", "launcher.ts", "--", ...command])).toEqual(command);
    expect(sentinelCommandArgv(["bun", "launcher.ts", ...command])).toEqual(command);
  });

  test("strips only one optional forwarded delimiter and rejects non-test commands", () => {
    const command = ["bun", "test", "tests/unit/runner/execution.test.ts"];
    expect(sentinelCommandArgv(["bun", "launcher.ts", "--", "--", ...command])).toEqual(command);
    expect(sentinelCommandArgv(["bun", "launcher.ts", "bun", "run", "build"])).toEqual([]);
  });
});
