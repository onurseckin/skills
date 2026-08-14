import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export function requirePinnedRuntime(runRoot: string, executingRuntime: string): void {
  let expected: string;
  let actual: string;
  try {
    expected = realpathSync(join(runRoot, "runtime"));
    actual = realpathSync(resolve(executingRuntime));
  } catch {
    throw new HarnessError("INTEGRITY", "pinned runtime is missing or unreadable");
  }
  if (actual !== expected) {
    throw new HarnessError(
      "INVALID_STATE",
      `run commands must use the pinned entrypoint: ${join(expected, "harness.ts")}`,
    );
  }
}
