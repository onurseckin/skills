import { describe, it, expect, beforeEach } from "bun:test";
import {
  executeWatchdogStatus,
  executeWatchdogCleanup,
  executeWatchdogPhaseCleanup,
  executeWatchdogVerify,
  executeWatchdogProbe,
} from "../../../olt/scripts/src/mind/watchdog-ops.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("mind/watchdog-ops", () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = scratchRoot(import.meta.path, "mind-watchdog-ops-test");
  });

  it("executes watchdog status command", () => {
    const res = executeWatchdogStatus({ "capsules-dir": scratchDir });
    expect(res).toBeDefined();
    expect(typeof res).toBe("object");
    expect(res["markdown"]).toBeDefined();
  });

  it("executes watchdog cleanup command", () => {
    const res = executeWatchdogCleanup({ "capsules-dir": scratchDir, "dry-run": true });
    expect(res).toBeDefined();
    expect(typeof res).toBe("object");
    expect(res["markdown"]).toBeDefined();
  });

  it("executes watchdog phase cleanup command", () => {
    const res = executeWatchdogPhaseCleanup({
      "capsules-dir": scratchDir,
      phase: "phase-1",
      "dry-run": true,
    });
    expect(res).toBeDefined();
    expect(typeof res).toBe("object");
    expect(res["markdown"]).toBeDefined();
  });

  it("executes watchdog verify command", () => {
    const res = executeWatchdogVerify({ "capsules-dir": scratchDir });
    expect(res).toBeDefined();
    expect(typeof res).toBe("object");
    expect(res["valid"]).toBeDefined();
  });

  it("executes watchdog probe command asynchronously", async () => {
    const res = await executeWatchdogProbe({ "capsules-dir": scratchDir });
    expect(res).toBeDefined();
    expect(typeof res).toBe("object");
    expect(res["markdown"]).toBeDefined();
  });
});
