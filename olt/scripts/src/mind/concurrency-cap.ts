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

export const MAX_FLEET_CONCURRENCY_CAP = 50;
export const DEFAULT_LEASE_DURATION_MS = 300_000;
export const DEFAULT_RATE_LIMIT_THRESHOLD_RATIO = 0.9;
export const DEFAULT_MAX_QUEUE_SIZE = 1000;

export const FLEET_PRIORITY_WEIGHTS: Readonly<Record<FleetTaskPriority, number>> = {
  CRITICAL: 100,
  HIGH: 75,
  MEDIUM: 50,
  LOW: 25,
  BACKGROUND: 10,
};

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
  readonly maxCap: number;
  readonly availableSeats: number;
  readonly queuedCount: number;
  readonly saturationRatio: number;
  readonly isSaturated: boolean;
  readonly rateLimitRisk: boolean;
  readonly seatsByTier: Readonly<Record<string, number>>;
  readonly queueByPriority: Readonly<Record<FleetTaskPriority, number>>;
}

export interface FleetConcurrencyOptions {
  readonly maxCap?: number | undefined;
  readonly defaultLeaseDurationMs?: number | undefined;
  readonly rateLimitThresholdRatio?: number | undefined;
  readonly maxQueueSize?: number | undefined;
  readonly minAllocationIntervalMs?: number | undefined;
}

export function getPriorityWeight(priority: FleetTaskPriority): number {
  return FLEET_PRIORITY_WEIGHTS[priority] ?? 50;
}

export function computeFleetSaturationRatio(
  activeCount: number,
  maxCap: number = MAX_FLEET_CONCURRENCY_CAP,
): number {
  if (maxCap <= 0) return 1.0;
  return Math.min(1.0, Math.max(0.0, activeCount / maxCap));
}

export function isFleetSaturated(
  activeCount: number,
  maxCap: number = MAX_FLEET_CONCURRENCY_CAP,
): boolean {
  return activeCount >= maxCap;
}

export function isRateLimitRisk(
  activeCount: number,
  maxCap: number = MAX_FLEET_CONCURRENCY_CAP,
  thresholdRatio: number = DEFAULT_RATE_LIMIT_THRESHOLD_RATIO,
): boolean {
  return computeFleetSaturationRatio(activeCount, maxCap) >= thresholdRatio;
}

interface QueuedEntry {
  readonly id: string;
  readonly options: AcquireSeatOptions;
  readonly enqueuedAtMs: number;
  readonly weight: number;
  readonly resolve: (seat: FleetSeat) => void;
  readonly reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout> | undefined;
}

export class FleetConcurrencyController {
  readonly maxCap: number;
  readonly defaultLeaseDurationMs: number;
  readonly rateLimitThresholdRatio: number;
  readonly maxQueueSize: number;
  readonly minAllocationIntervalMs: number;
  private lastAllocationMs: number = 0;
  private activeSeats: Map<string, FleetSeat> = new Map();
  private agentSeatMap: Map<string, string> = new Map();
  private availableSeatIndices: number[] = [];
  private queue: QueuedEntry[] = [];
  private queueSequence: number = 0;

  constructor(options?: FleetConcurrencyOptions) {
    this.maxCap = Math.max(1, options?.maxCap ?? MAX_FLEET_CONCURRENCY_CAP);
    this.defaultLeaseDurationMs = Math.max(
      1000,
      options?.defaultLeaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
    );
    this.rateLimitThresholdRatio = Math.min(
      1.0,
      Math.max(0.1, options?.rateLimitThresholdRatio ?? DEFAULT_RATE_LIMIT_THRESHOLD_RATIO),
    );
    this.maxQueueSize = Math.max(1, options?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE);
    this.minAllocationIntervalMs = Math.max(0, options?.minAllocationIntervalMs ?? 0);
    this.initIndices();
  }

  private initIndices(): void {
    this.availableSeatIndices = Array.from({ length: this.maxCap }, (_, i) => i);
  }

  private allocateSeat(options: AcquireSeatOptions, nowMs: number): FleetSeat {
    const seatIndex = this.availableSeatIndices.shift() ?? 0;
    const seatId = `seat-${seatIndex.toString().padStart(2, "0")}`;
    const leaseDuration = options.leaseDurationMs ?? this.defaultLeaseDurationMs;
    const seat: FleetSeat = {
      seatId,
      seatIndex,
      agentId: options.agentId,
      tier: options.tier,
      priority: options.priority ?? "MEDIUM",
      acquiredAtMs: nowMs,
      expiresAtMs: nowMs + leaseDuration,
      leaseDurationMs: leaseDuration,
      metadata: options.metadata,
    };
    this.activeSeats.set(seatId, seat);
    this.agentSeatMap.set(options.agentId, seatId);
    this.lastAllocationMs = nowMs;
    return seat;
  }

  tryAcquireSeat(options: AcquireSeatOptions, nowMs: number = Date.now()): TryAcquireSeatResult {
    this.reclaimStaleSeats(nowMs);
    const existingSeatId = this.agentSeatMap.get(options.agentId);
    if (existingSeatId) {
      const existingSeat = this.activeSeats.get(existingSeatId);
      if (existingSeat) return { granted: true, seat: existingSeat };
    }
    if (this.activeSeats.size < this.maxCap) {
      return { granted: true, seat: this.allocateSeat(options, nowMs) };
    }
    if (this.queue.length >= this.maxQueueSize) {
      return { granted: false, reason: "QUEUE_CAPACITY_EXCEEDED" };
    }
    return {
      granted: false,
      queued: true,
      queuePosition: this.queue.length + 1,
      reason: "FLEET_CAP_SATURATED",
    };
  }

  acquireSeat(options: AcquireSeatOptions, nowMs: number = Date.now()): Promise<FleetSeat> {
    const immediate = this.tryAcquireSeat(options, nowMs);
    if (immediate.granted && immediate.seat) return Promise.resolve(immediate.seat);
    if (this.queue.length >= this.maxQueueSize) {
      return Promise.reject(new Error("FLEET_CONCURRENCY_CAP: Queue capacity exceeded"));
    }
    return new Promise<FleetSeat>((resolve, reject) => {
      const weight = getPriorityWeight(options.priority ?? "MEDIUM");
      const requestId = `req-${++this.queueSequence}-${Date.now().toString(36)}`;
      const entry: QueuedEntry = {
        id: requestId,
        options,
        enqueuedAtMs: nowMs,
        weight,
        resolve,
        reject,
      };
      if (options.timeoutMs && options.timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.removeQueuedEntry(requestId);
          reject(
            new Error(
              `FLEET_CONCURRENCY_TIMEOUT: Timed out waiting for seat after ${options.timeoutMs}ms`,
            ),
          );
        }, options.timeoutMs);
      }
      this.insertQueuedEntry(entry);
    });
  }

  private insertQueuedEntry(entry: QueuedEntry): void {
    let insertIndex = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      const existing = this.queue[i];
      if (existing && entry.weight > existing.weight) {
        insertIndex = i;
        break;
      }
    }
    this.queue.splice(insertIndex, 0, entry);
  }

  private removeQueuedEntry(requestId: string): void {
    const idx = this.queue.findIndex((e) => e.id === requestId);
    if (idx !== -1) {
      const entry = this.queue[idx];
      if (entry?.timer) clearTimeout(entry.timer);
      this.queue.splice(idx, 1);
    }
  }

  releaseSeat(agentIdOrSeatId: string, nowMs: number = Date.now()): boolean {
    const seatId = this.agentSeatMap.get(agentIdOrSeatId) ?? agentIdOrSeatId;
    const seat = this.activeSeats.get(seatId);
    if (!seat) return false;
    this.activeSeats.delete(seatId);
    this.agentSeatMap.delete(seat.agentId);
    this.availableSeatIndices.push(seat.seatIndex);
    this.availableSeatIndices.sort((a, b) => a - b);
    this.drainNextQueueItem(nowMs);
    return true;
  }

  private drainNextQueueItem(nowMs: number): void {
    if (this.queue.length === 0 || this.activeSeats.size >= this.maxCap) return;
    const nextEntry = this.queue.shift();
    if (!nextEntry) return;
    if (nextEntry.timer) clearTimeout(nextEntry.timer);
    const seat = this.allocateSeat(nextEntry.options, nowMs);
    nextEntry.resolve(seat);
  }

  renewSeat(agentIdOrSeatId: string, extensionMs?: number, nowMs: number = Date.now()): boolean {
    const seatId = this.agentSeatMap.get(agentIdOrSeatId) ?? agentIdOrSeatId;
    const seat = this.activeSeats.get(seatId);
    if (!seat) return false;
    const duration = extensionMs ?? seat.leaseDurationMs;
    const base = nowMs > seat.expiresAtMs ? nowMs : seat.expiresAtMs;
    this.activeSeats.set(seatId, { ...seat, expiresAtMs: base + duration });
    return true;
  }

  reclaimStaleSeats(nowMs: number = Date.now()): number {
    let reclaimed = 0;
    const staleSeatIds: string[] = [];
    for (const [seatId, seat] of this.activeSeats.entries()) {
      if (seat.expiresAtMs <= nowMs) staleSeatIds.push(seatId);
    }
    for (const seatId of staleSeatIds) {
      if (this.releaseSeat(seatId, nowMs)) reclaimed++;
    }
    return reclaimed;
  }

  getSeat(agentIdOrSeatId: string): FleetSeat | undefined {
    const seatId = this.agentSeatMap.get(agentIdOrSeatId) ?? agentIdOrSeatId;
    return this.activeSeats.get(seatId);
  }

  isSaturated(): boolean {
    return this.activeSeats.size >= this.maxCap;
  }
  getActiveCount(): number {
    return this.activeSeats.size;
  }
  getQueuedCount(): number {
    return this.queue.length;
  }

  getStats(nowMs: number = Date.now()): FleetConcurrencyStats {
    const seatsByTier: Record<string, number> = {};
    for (const seat of this.activeSeats.values()) {
      seatsByTier[seat.tier] = (seatsByTier[seat.tier] ?? 0) + 1;
    }
    const queueByPriority: Record<FleetTaskPriority, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      BACKGROUND: 0,
    };
    for (const entry of this.queue) {
      const p = entry.options.priority ?? "MEDIUM";
      queueByPriority[p] = (queueByPriority[p] ?? 0) + 1;
    }
    const activeCount = this.activeSeats.size;
    const maxCap = this.maxCap;
    return {
      activeCount,
      maxCap,
      availableSeats: Math.max(0, maxCap - activeCount),
      queuedCount: this.queue.length,
      saturationRatio: computeFleetSaturationRatio(activeCount, maxCap),
      isSaturated: activeCount >= maxCap,
      rateLimitRisk: isRateLimitRisk(activeCount, maxCap, this.rateLimitThresholdRatio),
      seatsByTier,
      queueByPriority,
    };
  }

  clearQueue(reason?: string): void {
    const message = reason ?? "Fleet queue cleared";
    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (entry) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(new Error(message));
      }
    }
  }

  reset(): void {
    this.clearQueue("Fleet controller reset");
    this.activeSeats.clear();
    this.agentSeatMap.clear();
    this.initIndices();
    this.lastAllocationMs = 0;
  }
}

export function createFleetConcurrencyController(
  options?: FleetConcurrencyOptions,
): FleetConcurrencyController {
  return new FleetConcurrencyController(options);
}
