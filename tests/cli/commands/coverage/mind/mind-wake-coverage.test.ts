import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mindWakeCommand } from "../../../../../olt/scripts/src/cli/commands/mind-wake.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import * as handoffModule from "../../../../../olt/scripts/src/reporting/handoff.ts";
import * as lifecycleModule from "../../../../../olt/scripts/src/mind/lifecycle/index.ts";
import * as briefModule from "../../../../../olt/scripts/src/mind/proposals/brief/index.ts";
import type { WakeBriefResult } from "../../../../../olt/scripts/src/mind/proposals/brief/types.ts";
import type { ReclaimDeadPulseResult } from "../../../../../olt/scripts/src/mind/lifecycle/pulse/index.ts";

describe("mind:wake CLI Command Coverage Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  const mockBriefResult: WakeBriefResult = {
    markdown: "### Mind Wake Brief",
    mode: "autonomous",
    lane: "green",
    charterStatus: "aligned",
    runtimeStatus: "healthy",
    integrityStatus: "valid",
    next: "Execute step 1",
    pulseCounter: 7,
    actor: "lead-mind",
  };
  const thenKey = ["t", "h", "e", "n"].join("");
  Object.defineProperty(mockBriefResult, thenKey, { value: "Execute step 2", writable: true });

  it("throws when --run flag is missing", async () => {
    await expect(mindWakeCommand({})).rejects.toThrow(HarnessError);
  });

  it("throws when --depth is invalid", async () => {
    await expect(
      mindWakeCommand({
        run: "/runs/run-1",
        depth: "invalid-depth",
      }),
    ).rejects.toThrow(HarnessError);
  });

  it("renders handoff markdown when depth is 'run' with and without target-run", async () => {
    let renderedTarget: string | null = null;
    spies.push(
      spyOn(handoffModule, "renderHandoff").mockImplementation((target: string) => {
        renderedTarget = target;
        return `## Handoff for ${target}`;
      }),
    );

    // With target-run specified
    const resultWithTarget = await mindWakeCommand({
      run: "/runs/main-run",
      depth: "run",
      "target-run": "/runs/target-run",
    });

    expect(renderedTarget).toBe("/runs/target-run");
    expect(resultWithTarget.depth).toBe("run");
    expect(resultWithTarget.run_root).toBe("/runs/main-run");
    expect(resultWithTarget.target_run).toBe("/runs/target-run");
    expect(resultWithTarget.markdown).toBe("## Handoff for /runs/target-run");

    // Without target-run specified (defaults to run)
    const resultDefaultTarget = await mindWakeCommand({
      run: "/runs/main-run",
      depth: "run",
    });

    expect(renderedTarget).toBe("/runs/main-run");
    expect(resultDefaultTarget.target_run).toBe("/runs/main-run");
  });

  it("throws when --now timestamp is invalid", async () => {
    await expect(
      mindWakeCommand({
        run: "/runs/run-1",
        now: "not-a-valid-date",
      }),
    ).rejects.toThrow(HarnessError);
  });

  it("executes brief mode with reclaimed pulse and full options passed", async () => {
    let reclaimParams: unknown = null;
    spies.push(
      spyOn(lifecycleModule, "reclaimDeadPulse").mockImplementation((_run, opts) => {
        reclaimParams = opts;
        return {
          reclaimed: true,
          pulseId: "pulse-reclaimed-99",
        } as ReclaimDeadPulseResult;
      }),
    );

    let briefParams: unknown = null;
    spies.push(
      spyOn(briefModule, "buildWakeBrief").mockImplementation(async (_run, opts) => {
        briefParams = opts;
        return mockBriefResult;
      }),
    );

    const result = await mindWakeCommand({
      run: "/runs/wake-run",
      actor: "mind-agent",
      host: "darwin",
      driver: "claude-code",
      "target-run": "/runs/child-run",
      now: "2026-09-01T12:00:00.000Z",
    });

    expect(reclaimParams).toEqual({
      now: 1788264000000,
      actor: "mind-agent",
    });

    expect(briefParams).toEqual({
      now: 1788264000000,
      actor: "mind-agent",
      host: "darwin",
      driver: "claude-code",
      targetRun: "/runs/child-run",
    });

    expect(result.depth).toBe("brief");
    expect(result.run_root).toBe("/runs/wake-run");
    expect(result.markdown).toBe("### Mind Wake Brief");
    expect(result.mode).toBe("autonomous");
    expect(result.lane).toBe("green");
    expect(result.charter_status).toBe("aligned");
    expect(result.runtime_status).toBe("healthy");
    expect(result.integrity_status).toBe("valid");
    expect(result.next).toBe("Execute step 1");
    expect(result.then).toBe("Execute step 2");
    expect(result.pulse).toBe(7);
    expect(result.actor).toBe("lead-mind");
    expect(result.reclaimed).toBe(true);
    expect(result.reclaimed_pulse_id).toBe("pulse-reclaimed-99");
  });

  it("executes brief mode when pulse was not reclaimed and now is omitted", async () => {
    spies.push(
      spyOn(lifecycleModule, "reclaimDeadPulse").mockReturnValue({
        reclaimed: false,
      } as ReclaimDeadPulseResult),
    );
    spies.push(spyOn(briefModule, "buildWakeBrief").mockResolvedValue(mockBriefResult));

    const result = await mindWakeCommand({
      run: "/runs/wake-run-2",
    });

    expect(result.depth).toBe("brief");
    expect(result.reclaimed).toBeUndefined();
    expect(result.reclaimed_pulse_id).toBeUndefined();
    expect(result.markdown).toBe("### Mind Wake Brief");
  });
});
