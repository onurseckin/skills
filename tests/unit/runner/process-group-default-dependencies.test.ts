import { describe, expect, test } from "bun:test";
import {
  terminateProcessGroup,
  type ProcessGroupIdentity,
} from "../../../olt/scripts/src/runner/process-group.ts";

describe("terminateProcessGroup default inspect/wait dependencies", () => {
  test("uses the real process inspector and a real timer wait when no overrides are given", async () => {
    // Exercising the module's own default `inspect` (readProcessIdentity) and default `wait`
    // (a real setTimeout) without stubbing them: pid is this real, live test process, but the
    // expected identity's group/birth are deliberately wrong so the identity check fails and
    // no signal is ever actually sent — kill throwing proves that.
    const mismatchedExpected: ProcessGroupIdentity = {
      pid: process.pid,
      group: 999_999_999,
      birth: "not-the-real-birth",
    };
    const neverExits = new Promise<number>(() => undefined);
    const signals = await terminateProcessGroup(process.pid, 5, neverExits, mismatchedExpected, {
      kill: () => {
        throw new Error("must not signal a mismatched process group");
      },
    });
    expect(signals).toEqual([]);
  });
});
