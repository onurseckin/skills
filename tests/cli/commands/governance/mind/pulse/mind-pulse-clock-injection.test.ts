import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as path from "node:path";
import { execute } from "../../../../../../olt/scripts/src/cli/execute.ts";
import { findCommand } from "../../../../../../olt/scripts/src/cli/registry/index.ts";
import { mindPulseCommand } from "../../../../../../olt/scripts/src/cli/commands/mind-pulse.ts";
import { HarnessError } from "../../../../../../olt/scripts/src/core/errors/index.ts";
import * as storeModule from "../../../../../../olt/scripts/src/engine/store/index.ts";
import * as evidenceModule from "../../../../../../olt/scripts/src/mind/evidence/index.ts";
import type { Clock } from "../../../../../../olt/scripts/src/workflow/index.ts";
import {
  cleanupVirtualMindFS,
  scratchRoot,
  setupVirtualMindFS,
} from "../../../../../mind/fixtures/mind-fixture.ts";
import type { VirtualMemoryFS } from "../../../../../../olt/scripts/src/testing/virtual-fs/index.ts";

const OPENED_AT = "2026-09-01T12:00:00.000Z";
const DEADLINE_AT = "2026-09-01T12:15:00.000Z";
const BEFORE_DEADLINE = "2026-09-01T12:05:00.000Z";
const AFTER_DEADLINE = "2026-09-01T12:20:00.000Z";

function clockAt(iso: string): Clock {
  return { now: () => new Date(iso) };
}

describe("mind:pulse refuses caller-injected clock values", () => {
  let testDir: string;
  let vfs: VirtualMemoryFS;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    vfs = setupVirtualMindFS();
    testDir = scratchRoot("mind-pulse-clock");
    vfs.mkdirSync(path.join(testDir, ".olt"), { recursive: true });
    vfs.mkdirSync(path.join(testDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
    spies.length = 0;
    cleanupVirtualMindFS();
  });

  function mockOpenPulseRun(): void {
    const mockActiveRun = {
      runRoot: testDir,
      state: {
        mind: { halted: false },
        agents: [],
        pulse: {
          open: {
            pulse_id: "pulse-clock-1",
            opened_at: OPENED_AT,
            deadline_at: DEADLINE_AT,
          },
        },
        budget: { pulses_per_day: 100, base_interval_ms: 900_000 },
      },
    };
    spies.push(
      spyOn(storeModule, "loadRun").mockReturnValue(
        mockActiveRun as unknown as ReturnType<typeof storeModule.loadRun>,
      ),
    );
    spies.push(
      spyOn(evidenceModule, "verifyMilestoneEvidence").mockReturnValue({
        hashChain: { valid: true },
        milestones: [],
      } as unknown as ReturnType<typeof evidenceModule.verifyMilestoneEvidence>),
    );
  }

  it("never declares a now flag on the mind:pulse command surface", () => {
    const spec = findCommand("mind:pulse");
    expect(spec).toBeDefined();
    expect(spec?.flags.map((flag) => flag.name)).not.toContain("now");
  });

  it("rejects every argv spelling of --now before the handler runs", async () => {
    const spellings: ReadonlyArray<readonly [readonly string[], string]> = [
      [["--now", AFTER_DEADLINE], "unknown option: --now"],
      [[`--now=${AFTER_DEADLINE}`], "option --now does not take a value"],
      [["--now"], "unknown option: --now"],
    ];

    for (const [tail, message] of spellings) {
      const failure = await execute(["mind:pulse", "--run", "x", ...tail]).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(HarnessError);
      expect((failure as HarnessError).code).toBe("INVALID_ARGUMENT");
      expect((failure as HarnessError).message).toBe(message);
    }
  });

  it("derives nowMs from the injected clock and ignores a now value smuggled into flags", async () => {
    mockOpenPulseRun();

    const refusal = await mindPulseCommand(
      { run: testDir, actor: "mind-1", now: BEFORE_DEADLINE },
      undefined,
      clockAt(AFTER_DEADLINE),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(HarnessError);
    expect((refusal as HarnessError).message).toContain("past its deadline");
  });

  it("still reports an active pulse when the injected clock is inside the deadline", async () => {
    mockOpenPulseRun();

    const result = await mindPulseCommand(
      { run: testDir, actor: "mind-1", now: AFTER_DEADLINE },
      undefined,
      clockAt(BEFORE_DEADLINE),
    );

    expect(result.status).toBe("active");
    expect(result.pulse_id).toBe("pulse-clock-1");
  });
});
