export type SubagentTier =
  | "TIER_1"
  | "TIER_2"
  | "TIER_3"
  | "TIER_4"
  | "COORDINATOR"
  | "SUPERVISOR"
  | "IMPLEMENTER"
  | "VALIDATOR"
  | string;
export type FleetTaskPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND";

export interface FleetSeat {
  readonly seatId: string;
  readonly seatIndex: number;
  readonly agentId: string;
  readonly tier: SubagentTier;
  readonly priority: FleetTaskPriority;
  readonly acquiredAtMs: number;
  readonly expiresAtMs: number;
  readonly leaseDurationMs: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AcquireSeatOptions {
  readonly agentId: string;
  readonly tier: SubagentTier;
  readonly priority?: FleetTaskPriority | undefined;
  readonly leaseDurationMs?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface TryAcquireSeatResult {
  readonly granted: boolean;
  readonly seat?: FleetSeat | undefined;
  readonly queued?: boolean | undefined;
  readonly queuePosition?: number | undefined;
  readonly reason?: string | undefined;
}

export interface FleetConcurrencyStats {
  readonly activeCount: number;
  readonly activeSupervisorCount: number;
  readonly maxCap: number;
  readonly availableSeats: number;
  readonly queuedCount: number;
  readonly saturationRatio: number;
  readonly isSaturated: boolean;
  readonly rateLimitRisk: boolean;
  readonly seatsByTier: Readonly<Record<string, number>>;
  readonly supervisorsByTier: Readonly<Record<string, number>>;
  readonly queueByPriority: Readonly<Record<FleetTaskPriority, number>>;
}

export interface FleetConcurrencyOptions {
  readonly maxCap?: number | undefined;
  readonly defaultLeaseDurationMs?: number | undefined;
  readonly rateLimitThresholdRatio?: number | undefined;
  readonly maxQueueSize?: number | undefined;
  readonly minAllocationIntervalMs?: number | undefined;
}

export interface QueuedEntry {
  readonly id: string;
  readonly options: AcquireSeatOptions;
  readonly enqueuedAtMs: number;
  readonly weight: number;
  readonly resolve: (seat: FleetSeat) => void;
  readonly reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout> | undefined;
}
