import { HarnessError } from "../core/errors/index.ts";
import {
  computePolicyChecksum,
  detectPolicyDrift,
  executePolicyHook,
  handlePolicyDrift,
  inspectRepoPolicy,
  loadRepoPolicy,
  resolvePolicyLocation,
  saveRepoPolicy,
  verifyCommandAuthorization,
  type AuthorizationResult,
  type HookVariableContext,
  type LifecycleEventType,
  type PolicyDriftResult,
  type PolicyReloadEvent,
  type RepoPolicy,
} from "../policy/index.ts";

export interface PolicyReloadResult {
  readonly reloaded: boolean;
  readonly previousChecksum: string;
  readonly currentChecksum: string;
  readonly policy: RepoPolicy;
}

export type PolicyChangeListener = (
  newPolicy: RepoPolicy,
  event: PolicyReloadEvent,
) => void | Promise<void>;

export interface PolicyEngineOptions {
  readonly repoRoot?: string | undefined;
  readonly customPath?: string | undefined;
  readonly autoReloadIntervalMs?: number | undefined;
  readonly onReload?: ((newPolicy: RepoPolicy, previousPolicy?: RepoPolicy) => void | Promise<void>) | undefined;
  readonly onDrift?: ((result: PolicyDriftResult) => void | Promise<void>) | undefined;
}

export class PolicyEngine {
  private currentPolicy: RepoPolicy;
  private currentChecksum: string;
  private readonly repoRoot?: string | undefined;
  private readonly customPath?: string | undefined;
  private readonly listeners: Set<PolicyChangeListener> = new Set();
  private autoReloadTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onReloadCallback?: ((newPolicy: RepoPolicy, previousPolicy?: RepoPolicy) => void | Promise<void>) | undefined;
  private readonly onDriftCallback?: ((result: PolicyDriftResult) => void | Promise<void>) | undefined;

  constructor(options: PolicyEngineOptions = {}) {
    this.repoRoot = options.repoRoot;
    this.customPath = options.customPath;
    this.onReloadCallback = options.onReload;
    this.onDriftCallback = options.onDrift;
    this.currentPolicy = loadRepoPolicy(this.repoRoot, this.customPath);
    this.currentChecksum = computePolicyChecksum(this.repoRoot, this.customPath);

    if (options.autoReloadIntervalMs !== undefined && options.autoReloadIntervalMs > 0) {
      this.startAutoReload(options.autoReloadIntervalMs);
    }
  }

  public getPolicy(): RepoPolicy {
    return this.currentPolicy;
  }

  public getChecksum(): string {
    return this.currentChecksum;
  }

  public getRepoRoot(): string {
    const loc = resolvePolicyLocation(this.repoRoot, this.customPath);
    return loc.root;
  }

  public getPolicyPath(): string {
    const loc = resolvePolicyLocation(this.repoRoot, this.customPath);
    return loc.filePath;
  }

  public checkDrift(): PolicyDriftResult {
    return detectPolicyDrift(this.currentChecksum, this.repoRoot, this.customPath);
  }

  public async reload(): Promise<PolicyReloadResult> {
    const previousChecksum = this.currentChecksum;
    const previousPolicy = this.currentPolicy;
    const currentChecksum = computePolicyChecksum(this.repoRoot, this.customPath);

    if (currentChecksum === previousChecksum) {
      return {
        reloaded: false,
        previousChecksum,
        currentChecksum,
        policy: this.currentPolicy,
      };
    }

    const newPolicy = loadRepoPolicy(this.repoRoot, this.customPath);
    this.currentPolicy = newPolicy;
    this.currentChecksum = currentChecksum;

    const event: PolicyReloadEvent = {
      type: "POLICY_RELOAD_EVENT",
      timestamp: new Date().toISOString(),
      previous_checksum: previousChecksum,
      new_checksum: currentChecksum,
      policy_path: this.getPolicyPath(),
    };

    if (this.onReloadCallback) {
      await this.onReloadCallback(newPolicy, previousPolicy);
    }

    for (const listener of this.listeners) {
      await listener(newPolicy, event);
    }

    return {
      reloaded: true,
      previousChecksum,
      currentChecksum,
      policy: newPolicy,
    };
  }

  public reloadSync(): PolicyReloadResult {
    const previousChecksum = this.currentChecksum;
    const currentChecksum = computePolicyChecksum(this.repoRoot, this.customPath);

    if (currentChecksum === previousChecksum) {
      return {
        reloaded: false,
        previousChecksum,
        currentChecksum,
        policy: this.currentPolicy,
      };
    }

    const newPolicy = loadRepoPolicy(this.repoRoot, this.customPath);
    this.currentPolicy = newPolicy;
    this.currentChecksum = currentChecksum;

    const event: PolicyReloadEvent = {
      type: "POLICY_RELOAD_EVENT",
      timestamp: new Date().toISOString(),
      previous_checksum: previousChecksum,
      new_checksum: currentChecksum,
      policy_path: this.getPolicyPath(),
    };

    for (const listener of this.listeners) {
      void listener(newPolicy, event);
    }

    return {
      reloaded: true,
      previousChecksum,
      currentChecksum,
      policy: newPolicy,
    };
  }

  public async handleDrift(): Promise<PolicyReloadResult> {
    const drift = this.checkDrift();
    if (this.onDriftCallback) {
      await this.onDriftCallback(drift);
    }
    if (drift.drifted) {
      return this.reload();
    }
    return {
      reloaded: false,
      previousChecksum: this.currentChecksum,
      currentChecksum: this.currentChecksum,
      policy: this.currentPolicy,
    };
  }

  public startAutoReload(intervalMs: number = 1000): void {
    this.stopAutoReload();
    const interval = Math.max(50, intervalMs);
    this.autoReloadTimer = setInterval(() => {
      void this.handleDrift();
    }, interval);
    if (typeof this.autoReloadTimer === "object" && "unref" in this.autoReloadTimer) {
      this.autoReloadTimer.unref();
    }
  }

  public stopAutoReload(): void {
    if (this.autoReloadTimer !== null) {
      clearInterval(this.autoReloadTimer);
      this.autoReloadTimer = null;
    }
  }

  public isAutoReloadRunning(): boolean {
    return this.autoReloadTimer !== null;
  }

  public subscribe(listener: PolicyChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public updatePolicy(mutator: (current: RepoPolicy) => RepoPolicy): string {
    const updated = mutator(this.currentPolicy);
    const savedPath = saveRepoPolicy(updated, this.repoRoot, this.customPath);
    this.reloadSync();
    return savedPath;
  }

  public async executeHook(
    event: LifecycleEventType,
    context?: HookVariableContext,
  ): Promise<void> {
    await executePolicyHook(
      event,
      context ?? {},
      {
        policy: this.currentPolicy,
        repoRoot: this.getRepoRoot(),
      },
    );
  }

  public verifyCommand(command: string, role: string): AuthorizationResult {
    return verifyCommandAuthorization({ role }, command, this.currentPolicy);
  }
}

let globalPolicyEngine: PolicyEngine | null = null;

export function createPolicyEngine(options?: PolicyEngineOptions): PolicyEngine {
  return new PolicyEngine(options);
}

export function getGlobalPolicyEngine(options?: PolicyEngineOptions): PolicyEngine {
  if (!globalPolicyEngine) {
    globalPolicyEngine = new PolicyEngine(options);
  }
  return globalPolicyEngine;
}

export function resetGlobalPolicyEngine(): void {
  if (globalPolicyEngine) {
    globalPolicyEngine.stopAutoReload();
    globalPolicyEngine = null;
  }
}
