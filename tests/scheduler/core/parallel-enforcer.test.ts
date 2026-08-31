import { describe, it, expect } from "bun:test";
import { ParallelWaveDispatchEnforcer } from "../../../../olt/scripts/src/engine/scheduler/dispatch/parallel-enforcer.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("ParallelWaveDispatchEnforcer", () => {
  it("can be instantiated", () => {
    expect(new ParallelWaveDispatchEnforcer()).toBeDefined();
  });

  it("blocks single-agent dispatch when wave contains 3 ready disjoint lanes", () => {
    const wave = { waveIndex: 1, readyTaskIds: ["t1", "t2", "t3"] };

    expect(() => {
      ParallelWaveDispatchEnforcer.assertParallelDispatch(wave, 1);
    }).toThrow(HarnessError);
  });

  it("permits full parallel batch dispatch", () => {
    const wave = { waveIndex: 1, readyTaskIds: ["t1", "t2", "t3"] };

    expect(() => {
      ParallelWaveDispatchEnforcer.assertParallelDispatch(wave, 3);
    }).not.toThrow();
  });
});
