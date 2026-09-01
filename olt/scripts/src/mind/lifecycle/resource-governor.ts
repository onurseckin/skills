export type ResourceGovernorState =
  | "NOMINAL"
  | "WARNING"
  | "EXHAUSTED"
  | "HIBERNATING"
  | "RECOVERING";

export type ResourceType = "API_RPM" | "API_TPM" | "DAILY_COMPUTE" | "CONCURRENCY";

export interface ResourceHeadroom {
  readonly resourceType: ResourceType;
  readonly currentUsage: number;
  readonly maxLimit: number;
  readonly remainingHeadroom: number;
  readonly utilizationRatio: number;
}

export interface ExternalThrottleEvent {
  readonly resourceType: ResourceType;
  readonly retryAfterMs: number;
  readonly reason: string;
  readonly statusCode?: number;
}

export interface ResourceGovernorLimits {
  readonly maxRpm?: number;
  readonly maxTpm?: number;
  readonly maxDailyCompute?: number;
  readonly maxConcurrency?: number;
}

export interface ResourceGovernorOptions {
  readonly limits?: ResourceGovernorLimits;
  readonly warningThreshold?: number;
  readonly criticalThreshold?: number;
  readonly recoveryThreshold?: number;
  readonly windowDurationRpmMs?: number;
  readonly windowDurationTpmMs?: number;
  readonly autoTransitionToHibernating?: boolean;
}

export interface GovernorStatus {
  readonly state: ResourceGovernorState;
  readonly headroom: Record<ResourceType, ResourceHeadroom>;
  readonly throttleCount: number;
  readonly lastThrottleEvent?: ExternalThrottleEvent | undefined;
  readonly estimatedRecoveryMs: number;
}

export interface CanDispatchResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly limitingResource?: ResourceType;
}

const STATE_RANKS: Record<ResourceGovernorState, number> = {
  NOMINAL: 0,
  RECOVERING: 1,
  WARNING: 2,
  EXHAUSTED: 3,
  HIBERNATING: 4,
};

export function calculateUtilizationRatio(current: number, limit: number): number {
  if (limit <= 0) return current > 0 ? 1.0 : 0.0;
  return Math.max(0.0, Math.min(1.0, current / limit));
}

export function calculateRemainingHeadroom(current: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.max(0, limit - current);
}

export function isStateStricter(
  stateA: ResourceGovernorState,
  stateB: ResourceGovernorState,
): boolean {
  return STATE_RANKS[stateA] > STATE_RANKS[stateB];
}

interface WindowBucket {
  readonly timestamp: number;
  readonly count: number;
}

export class ResourceGovernor {
  private limits: {
    maxRpm: number;
    maxTpm: number;
    maxDailyCompute: number;
    maxConcurrency: number;
  };
  private warningThreshold: number;
  private criticalThreshold: number;
  private recoveryThreshold: number;
  private windowDurationRpmMs: number;
  private windowDurationTpmMs: number;
  private autoTransitionToHibernating: boolean;

  private state: ResourceGovernorState = "NOMINAL";
  private activeConcurrency = 0;
  private dailyComputeUsed = 0;
  private rpmBuckets: WindowBucket[] = [];
  private tpmBuckets: WindowBucket[] = [];

  private throttleCount = 0;
  private lastThrottleEvent?: ExternalThrottleEvent;
  private throttleUntilMs = 0;

  private stateChangeListeners: ((
    from: ResourceGovernorState,
    to: ResourceGovernorState,
  ) => void)[] = [];
  private quotaWarningListeners: ((warning: ResourceHeadroom) => void)[] = [];
  private hibernationListeners: ((resource: ResourceType) => void)[] = [];

  constructor(options?: ResourceGovernorOptions) {
    this.limits = {
      maxRpm: options?.limits?.maxRpm ?? 1000,
      maxTpm: options?.limits?.maxTpm ?? 100_000,
      maxDailyCompute: options?.limits?.maxDailyCompute ?? 1_000_000,
      maxConcurrency: options?.limits?.maxConcurrency ?? 20,
    };
    this.warningThreshold = options?.warningThreshold ?? 0.8;
    this.criticalThreshold = options?.criticalThreshold ?? 0.9;
    this.recoveryThreshold = options?.recoveryThreshold ?? 0.6;
    this.windowDurationRpmMs = options?.windowDurationRpmMs ?? 60_000;
    this.windowDurationTpmMs = options?.windowDurationTpmMs ?? 60_000;
    this.autoTransitionToHibernating = options?.autoTransitionToHibernating ?? true;
  }

  public getLimits(): Readonly<Required<ResourceGovernorLimits>> {
    return { ...this.limits };
  }

  public setQuotaLimits(newLimits: Partial<ResourceGovernorLimits>): void {
    if (newLimits.maxRpm !== undefined) this.limits.maxRpm = newLimits.maxRpm;
    if (newLimits.maxTpm !== undefined) this.limits.maxTpm = newLimits.maxTpm;
    if (newLimits.maxDailyCompute !== undefined)
      this.limits.maxDailyCompute = newLimits.maxDailyCompute;
    if (newLimits.maxConcurrency !== undefined)
      this.limits.maxConcurrency = newLimits.maxConcurrency;
  }

  public onStateChange(
    listener: (from: ResourceGovernorState, to: ResourceGovernorState) => void,
  ): void {
    this.stateChangeListeners.push(listener);
  }

  public onQuotaWarning(listener: (warning: ResourceHeadroom) => void): void {
    this.quotaWarningListeners.push(listener);
  }

  public onHibernationTrigger(listener: (resource: ResourceType) => void): void {
    this.hibernationListeners.push(listener);
  }

  private pruneWindows(now: number): void {
    const rpmCutoff = now - this.windowDurationRpmMs;
    const tpmCutoff = now - this.windowDurationTpmMs;
    this.rpmBuckets = this.rpmBuckets.filter((b) => b.timestamp >= rpmCutoff);
    this.tpmBuckets = this.tpmBuckets.filter((b) => b.timestamp >= tpmCutoff);
  }

  private getRpmUsage(now: number): number {
    this.pruneWindows(now);
    return this.rpmBuckets.reduce((acc, b) => acc + b.count, 0);
  }

  private getTpmUsage(now: number): number {
    this.pruneWindows(now);
    return this.tpmBuckets.reduce((acc, b) => acc + b.count, 0);
  }

  private evaluateState(now: number): ResourceGovernorState {
    if (now < this.throttleUntilMs) {
      return "HIBERNATING";
    }

    const rpmRatio = calculateUtilizationRatio(this.getRpmUsage(now), this.limits.maxRpm);
    const tpmRatio = calculateUtilizationRatio(this.getTpmUsage(now), this.limits.maxTpm);
    const concurrencyRatio = calculateUtilizationRatio(
      this.activeConcurrency,
      this.limits.maxConcurrency,
    );
    const computeRatio = calculateUtilizationRatio(
      this.dailyComputeUsed,
      this.limits.maxDailyCompute,
    );

    const maxRatio = Math.max(rpmRatio, tpmRatio, concurrencyRatio, computeRatio);

    if (maxRatio >= this.criticalThreshold) {
      return "HIBERNATING";
    }
    if (maxRatio >= this.warningThreshold) {
      return "WARNING";
    }
    if (this.state === "HIBERNATING" || this.state === "WARNING") {
      if (maxRatio <= this.recoveryThreshold) {
        return "NOMINAL";
      }
      return "RECOVERING";
    }
    return "NOMINAL";
  }

  private updateState(newState: ResourceGovernorState): void {
    if (newState !== this.state) {
      const oldState = this.state;
      this.state = newState;
      for (const listener of this.stateChangeListeners) {
        listener(oldState, newState);
      }
    }
  }

  public getStatus(now: number = Date.now()): GovernorStatus {
    const nextState = this.evaluateState(now);
    this.updateState(nextState);

    const rpmUsage = this.getRpmUsage(now);
    const tpmUsage = this.getTpmUsage(now);

    const headroom: Record<ResourceType, ResourceHeadroom> = {
      API_RPM: {
        resourceType: "API_RPM",
        currentUsage: rpmUsage,
        maxLimit: this.limits.maxRpm,
        remainingHeadroom: calculateRemainingHeadroom(rpmUsage, this.limits.maxRpm),
        utilizationRatio: calculateUtilizationRatio(rpmUsage, this.limits.maxRpm),
      },
      API_TPM: {
        resourceType: "API_TPM",
        currentUsage: tpmUsage,
        maxLimit: this.limits.maxTpm,
        remainingHeadroom: calculateRemainingHeadroom(tpmUsage, this.limits.maxTpm),
        utilizationRatio: calculateUtilizationRatio(tpmUsage, this.limits.maxTpm),
      },
      DAILY_COMPUTE: {
        resourceType: "DAILY_COMPUTE",
        currentUsage: this.dailyComputeUsed,
        maxLimit: this.limits.maxDailyCompute,
        remainingHeadroom: calculateRemainingHeadroom(
          this.dailyComputeUsed,
          this.limits.maxDailyCompute,
        ),
        utilizationRatio: calculateUtilizationRatio(
          this.dailyComputeUsed,
          this.limits.maxDailyCompute,
        ),
      },
      CONCURRENCY: {
        resourceType: "CONCURRENCY",
        currentUsage: this.activeConcurrency,
        maxLimit: this.limits.maxConcurrency,
        remainingHeadroom: calculateRemainingHeadroom(
          this.activeConcurrency,
          this.limits.maxConcurrency,
        ),
        utilizationRatio: calculateUtilizationRatio(
          this.activeConcurrency,
          this.limits.maxConcurrency,
        ),
      },
    };

    const estimatedRecoveryMs = Math.max(0, this.throttleUntilMs - now);

    return {
      state: this.state,
      headroom,
      throttleCount: this.throttleCount,
      lastThrottleEvent: this.lastThrottleEvent,
      estimatedRecoveryMs,
    };
  }

  public recordUsage(
    usage: { requests?: number; tokens?: number; computeUnits?: number },
    now: number = Date.now(),
  ): GovernorStatus {
    if (usage.requests) {
      this.rpmBuckets.push({ timestamp: now, count: usage.requests });
    }
    if (usage.tokens) {
      this.tpmBuckets.push({ timestamp: now, count: usage.tokens });
    }
    if (usage.computeUnits) {
      this.dailyComputeUsed += usage.computeUnits;
    }

    const status = this.getStatus(now);

    if (status.state === "WARNING") {
      for (const hr of Object.values(status.headroom)) {
        if (hr.utilizationRatio >= this.warningThreshold) {
          for (const listener of this.quotaWarningListeners) {
            listener(hr);
          }
        }
      }
    } else if (status.state === "HIBERNATING") {
      for (const hr of Object.values(status.headroom)) {
        if (hr.utilizationRatio >= this.criticalThreshold) {
          for (const listener of this.hibernationListeners) {
            listener(hr.resourceType);
          }
        }
      }
    }

    return status;
  }

  public recordExternalThrottle(
    event: ExternalThrottleEvent,
    now: number = Date.now(),
  ): GovernorStatus {
    this.throttleCount++;
    this.lastThrottleEvent = event;
    this.throttleUntilMs = Math.max(this.throttleUntilMs, now + event.retryAfterMs);

    if (this.autoTransitionToHibernating) {
      this.updateState("HIBERNATING");
    }

    return this.getStatus(now);
  }

  public acquireConcurrency(seats = 1, now: number = Date.now()): boolean {
    if (this.activeConcurrency + seats > this.limits.maxConcurrency) {
      return false;
    }
    this.activeConcurrency += seats;
    this.getStatus(now);
    return true;
  }

  public releaseConcurrency(seats = 1, now: number = Date.now()): number {
    this.activeConcurrency = Math.max(0, this.activeConcurrency - seats);
    this.getStatus(now);
    return this.activeConcurrency;
  }

  public resetWindow(resourceType?: ResourceType, _now: number = Date.now()): void {
    if (!resourceType || resourceType === "API_RPM") {
      this.rpmBuckets = [];
    }
    if (!resourceType || resourceType === "API_TPM") {
      this.tpmBuckets = [];
    }
    if (!resourceType || resourceType === "DAILY_COMPUTE") {
      this.dailyComputeUsed = 0;
    }
    if (!resourceType || resourceType === "CONCURRENCY") {
      this.activeConcurrency = 0;
    }
    this.throttleUntilMs = 0;
  }

  public canDispatch(
    requests = 1,
    tokens = 0,
    concurrency = 1,
    now: number = Date.now(),
  ): CanDispatchResult {
    if (this.activeConcurrency + concurrency > this.limits.maxConcurrency) {
      return {
        allowed: false,
        reason: `Dispatch rejected: Concurrency capacity exceeded (${this.activeConcurrency + concurrency}/${this.limits.maxConcurrency}).`,
        limitingResource: "CONCURRENCY",
      };
    }

    if (this.getRpmUsage(now) + requests > this.limits.maxRpm) {
      return {
        allowed: false,
        reason: "Dispatch rejected: RPM capacity exceeded.",
        limitingResource: "API_RPM",
      };
    }

    if (this.getTpmUsage(now) + tokens > this.limits.maxTpm) {
      return {
        allowed: false,
        reason: "Dispatch rejected: TPM capacity exceeded.",
        limitingResource: "API_TPM",
      };
    }

    const status = this.getStatus(now);
    if (status.state === "HIBERNATING") {
      return {
        allowed: false,
        reason: `Dispatch rejected: Resource governor in HIBERNATING state (estimated recovery: ${status.estimatedRecoveryMs}ms).`,
      };
    }

    return { allowed: true };
  }
}

export function createResourceGovernor(options?: ResourceGovernorOptions): ResourceGovernor {
  return new ResourceGovernor(options);
}
