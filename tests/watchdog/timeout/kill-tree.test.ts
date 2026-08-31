import { describe, expect, it } from "bun:test";
import {
  defaultKillProcessTree,
  executeSignalEscalation,
} from "../../../olt/scripts/src/watchdog/process-timeout/kill-tree.ts";

describe("Signal Escalation & Process Tree Termination", () => {
  it("defaultKillProcessTree safely attempts process.kill and catches invalid PIDs", () => {
    expect(defaultKillProcessTree(process.pid, "SIGCONT")).toBe(true);
    expect(defaultKillProcessTree(-99999, "SIGTERM")).toBe(false);
  });

  it("executeSignalEscalation delivers SIGTERM then waits grace period then delivers SIGKILL", async () => {
    const signalsDelivered: NodeJS.Signals[] = [];
    let waitedMs = 0;

    const killFn = (pid: number, signal: NodeJS.Signals) => {
      signalsDelivered.push(signal);
      return true;
    };

    const waitFn = async (ms: number) => {
      waitedMs += ms;
    };

    const recorded: NodeJS.Signals[] = [];
    const res = await executeSignalEscalation(1234, 500, recorded, killFn, waitFn);

    expect(res).toEqual(["SIGTERM", "SIGKILL"]);
    expect(signalsDelivered).toEqual(["SIGTERM", "SIGKILL"]);
    expect(waitedMs).toBe(500);
  });

  it("skips SIGTERM and grace period when graceMs is 0", async () => {
    const signalsDelivered: NodeJS.Signals[] = [];
    let waitedMs = 0;

    const killFn = (pid: number, signal: NodeJS.Signals) => {
      signalsDelivered.push(signal);
      return true;
    };

    const waitFn = async (ms: number) => {
      waitedMs += ms;
    };

    const recorded: NodeJS.Signals[] = [];
    const res = await executeSignalEscalation(1234, 0, recorded, killFn, waitFn);

    expect(res).toEqual(["SIGKILL"]);
    expect(signalsDelivered).toEqual(["SIGKILL"]);
    expect(waitedMs).toBe(0);
  });

  it("safely ignores undefined, non-safe, or root PIDs (<= 1)", async () => {
    const recorded: NodeJS.Signals[] = [];
    const killFn = () => true;
    const waitFn = async () => {};

    expect(await executeSignalEscalation(undefined, 100, recorded, killFn, waitFn)).toEqual([]);
    expect(await executeSignalEscalation(1, 100, recorded, killFn, waitFn)).toEqual([]);
    expect(await executeSignalEscalation(0, 100, recorded, killFn, waitFn)).toEqual([]);
    expect(await executeSignalEscalation(-5, 100, recorded, killFn, waitFn)).toEqual([]);
  });
});
