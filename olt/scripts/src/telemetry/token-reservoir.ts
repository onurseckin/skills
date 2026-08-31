export interface ReservoirLease {
  readonly leaseId: string;
  readonly agentId: string;
  readonly reservedPercentage: number;
  readonly estimatedTokens?: number | undefined;
  readonly grantedAt: number;
  readonly expiresAt: number;
}

export interface ReserveLeaseOptions {
  readonly agentId: string;
  readonly reservedPercentage?: number | undefined;
  readonly estimatedTokens?: number | undefined;
  readonly ttlMs?: number | undefined;
}

export interface ReservoirStatus {
  readonly activeLeaseCount: number;
  readonly totalReservedPercentage: number;
  readonly totalEstimatedTokens: number;
  readonly activeLeases: readonly ReservoirLease[];
}

export const DEFAULT_PER_AGENT_BUFFER_PERCENT = 2.5;
export const DEFAULT_LEASE_TTL_MS = 60_000;
export const MAX_CONCURRENCY_RESERVATION_PERCENT = 50.0;

export class TokenReservoir {
  private readonly leases: Map<string, ReservoirLease> = new Map();
  private readonly defaultPerAgentBuffer: number;
  private readonly defaultTtlMs: number;

  constructor(options: { defaultPerAgentBuffer?: number; defaultTtlMs?: number } = {}) {
    this.defaultPerAgentBuffer = options.defaultPerAgentBuffer ?? DEFAULT_PER_AGENT_BUFFER_PERCENT;
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_LEASE_TTL_MS;
  }

  public reserveLease(options: ReserveLeaseOptions): ReservoirLease {
    this.pruneExpired();
    const now = Date.now();
    const ttl = options.ttlMs ?? this.defaultTtlMs;
    const reservedPercentage = options.reservedPercentage ?? this.defaultPerAgentBuffer;
    const leaseId = `lease_${options.agentId}_${now}_${Math.random().toString(36).slice(2, 7)}`;

    const lease: ReservoirLease = {
      leaseId,
      agentId: options.agentId,
      reservedPercentage,
      estimatedTokens: options.estimatedTokens,
      grantedAt: now,
      expiresAt: now + ttl,
    };

    this.leases.set(leaseId, lease);
    return lease;
  }

  public releaseLease(leaseId: string): boolean {
    return this.leases.delete(leaseId);
  }

  public releaseByAgent(agentId: string): number {
    let released = 0;
    for (const [id, lease] of this.leases.entries()) {
      if (lease.agentId === agentId) {
        this.leases.delete(id);
        released += 1;
      }
    }
    return released;
  }

  public pruneExpired(now: number = Date.now()): number {
    let pruned = 0;
    for (const [id, lease] of this.leases.entries()) {
      if (now >= lease.expiresAt) {
        this.leases.delete(id);
        pruned += 1;
      }
    }
    return pruned;
  }

  public getStatus(now: number = Date.now()): ReservoirStatus {
    this.pruneExpired(now);
    const activeLeases = Array.from(this.leases.values());
    const totalReservedPercentage = activeLeases.reduce((acc, l) => acc + l.reservedPercentage, 0);
    const totalEstimatedTokens = activeLeases.reduce((acc, l) => acc + (l.estimatedTokens ?? 0), 0);

    return {
      activeLeaseCount: activeLeases.length,
      totalReservedPercentage: Math.min(
        MAX_CONCURRENCY_RESERVATION_PERCENT,
        totalReservedPercentage,
      ),
      totalEstimatedTokens,
      activeLeases,
    };
  }

  public calculateEffectiveQuota(
    observedQuota: number | null,
    activeAgentsCount = 0,
    now: number = Date.now(),
  ): number | null {
    if (observedQuota === null) return null;
    const status = this.getStatus(now);
    const activeConcurrency = Math.max(status.activeLeaseCount, activeAgentsCount);
    const concurrencyBuffer =
      status.totalReservedPercentage > 0
        ? status.totalReservedPercentage
        : Math.min(
            MAX_CONCURRENCY_RESERVATION_PERCENT,
            activeConcurrency * this.defaultPerAgentBuffer,
          );

    const effective = Math.max(0, observedQuota - concurrencyBuffer);
    return Math.round(effective * 100) / 100;
  }

  public clear(): void {
    this.leases.clear();
  }
}
