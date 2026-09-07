import type { AcquireSeatOptions, FleetSeat } from "./types.ts";

export class AmbientSeatRegistry {
  private readonly seats: Map<string, FleetSeat> = new Map();

  allocate(options: AcquireSeatOptions, nowMs: number, defaultLeaseDurationMs: number): FleetSeat {
    const existing = this.seats.get(options.agentId);
    if (existing) return existing;
    const leaseDuration = options.leaseDurationMs ?? defaultLeaseDurationMs;
    const seat: FleetSeat = {
      seatId: `ambient-${options.agentId}`,
      seatIndex: -1,
      agentId: options.agentId,
      tier: options.tier,
      priority: options.priority ?? "MEDIUM",
      acquiredAtMs: nowMs,
      expiresAtMs: nowMs + leaseDuration,
      leaseDurationMs: leaseDuration,
      metadata: options.metadata,
    };
    this.seats.set(options.agentId, seat);
    return seat;
  }

  release(agentIdOrSeatId: string): boolean {
    if (this.seats.delete(agentIdOrSeatId)) return true;
    for (const [agentId, seat] of this.seats.entries()) {
      if (seat.seatId === agentIdOrSeatId) {
        this.seats.delete(agentId);
        return true;
      }
    }
    return false;
  }

  renew(agentIdOrSeatId: string, extensionMs: number | undefined, nowMs: number): boolean {
    const seat = this.get(agentIdOrSeatId);
    if (!seat) return false;
    const duration = extensionMs ?? seat.leaseDurationMs;
    const base = nowMs > seat.expiresAtMs ? nowMs : seat.expiresAtMs;
    this.seats.set(seat.agentId, { ...seat, expiresAtMs: base + duration });
    return true;
  }

  get(agentIdOrSeatId: string): FleetSeat | undefined {
    const direct = this.seats.get(agentIdOrSeatId);
    if (direct) return direct;
    for (const seat of this.seats.values()) {
      if (seat.seatId === agentIdOrSeatId) return seat;
    }
    return undefined;
  }

  reclaimStale(nowMs: number): number {
    const staleAgentIds: string[] = [];
    for (const [agentId, seat] of this.seats.entries()) {
      if (seat.expiresAtMs <= nowMs) staleAgentIds.push(agentId);
    }
    for (const agentId of staleAgentIds) this.seats.delete(agentId);
    return staleAgentIds.length;
  }

  get size(): number {
    return this.seats.size;
  }

  values(): IterableIterator<FleetSeat> {
    return this.seats.values();
  }

  clear(): void {
    this.seats.clear();
  }
}
