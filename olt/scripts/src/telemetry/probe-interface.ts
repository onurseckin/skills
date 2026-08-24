import type { PlatformProbeResult } from "./types.ts";

export interface TelemetryCollector {
  readonly platformId: string;
  probe(): Promise<PlatformProbeResult>;
}
