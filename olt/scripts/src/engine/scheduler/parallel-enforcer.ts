import { HarnessError } from "../../core/errors/harness-error.ts";

export interface WaveTopology {
  readonly waveIndex: number;
  readonly readyTaskIds: readonly string[];
}

export class ParallelWaveDispatchEnforcer {
  public static assertParallelDispatch(wave: WaveTopology, requestedSubagentCount: number): void {
    const laneCount = wave.readyTaskIds.length;
    if (laneCount > 1 && requestedSubagentCount < laneCount) {
      throw new HarnessError(
        "INVALID_STATE",
        `[FALSE_SERIALIZATION_BLUNDER] Wave ${wave.waveIndex} contains ${laneCount} ready disjoint lanes (${wave.readyTaskIds.join(", ")}). You MUST invoke all ${laneCount} subagents in parallel via Subagents: [...]. Single-thread simulation is prohibited.`,
      );
    }
  }
}
