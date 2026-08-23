import { describe, expect, test } from "bun:test";
import { processSnapshot } from "../../../olt/scripts/src/runner/process-tree.ts";

describe("processSnapshot", () => {
  test("parses the real ps output and finds this live process among the topology", async () => {
    const processes = await processSnapshot();
    const self = processes.get(process.pid);
    expect(self).toBeDefined();
    expect(self!.pid).toBe(process.pid);
    expect(Number.isSafeInteger(self!.parent)).toBe(true);
    expect(Number.isSafeInteger(self!.group)).toBe(true);
  });

  test("skips lines that do not match the pid/ppid/pgid shape", async () => {
    const processes = await processSnapshot(
      async () => "not a process line\n  7  8  9  \nabc def ghi\n",
    );
    expect(processes).toEqual(new Map([[7, { pid: 7, parent: 8, group: 9 }]]));
  });

  test("retries after a transient snapshot failure and succeeds once ps responds", async () => {
    let calls = 0;
    const processes = await processSnapshot(async () => {
      calls += 1;
      if (calls < 2) throw new Error("ps transiently unavailable");
      return "10 1 10\n";
    });
    expect(calls).toBe(2);
    expect(processes).toEqual(new Map([[10, { pid: 10, parent: 1, group: 10 }]]));
  });

  test("wraps a persistent Error failure into a HarnessError after exhausting retries", async () => {
    let calls = 0;
    await expect(
      processSnapshot(async () => {
        calls += 1;
        throw new Error("ps permanently unavailable");
      }),
    ).rejects.toThrow("cannot inspect command descendants: ps permanently unavailable");
    // One initial attempt plus the module's fixed retry budget.
    expect(calls).toBe(4);
  });

  test("stringifies a non-Error rejection when every retry is exhausted", async () => {
    await expect(
      processSnapshot(async () => {
        throw "not an Error instance";
      }),
    ).rejects.toThrow("cannot inspect command descendants: not an Error instance");
  });
});
