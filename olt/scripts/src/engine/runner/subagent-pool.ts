import { HarnessError } from "../../core/errors/index.ts";

export const MAX_SUBAGENT_CAPACITY = 50;

export interface SubagentSlotOptions {
  readonly agentId?: string;
  readonly role?: string;
  readonly tier?: number;
  readonly taskId?: string;
  readonly timeoutMs?: number;
}

export interface SubagentSlotReceipt {
  readonly receiptId: string;
  readonly agentId: string;
  readonly role: string;
  readonly tier: number;
  readonly taskId?: string;
  readonly acquiredAt: string;
  readonly activeCount: number;
  readonly release: () => void;
}

export interface SubagentPoolStats {
  readonly maxCapacity: number;
  readonly activeCount: number;
  readonly queueDepth: number;
  readonly totalAcquired: number;
  readonly totalReleased: number;
}

interface QueuedRequest {
  readonly id: string;
  readonly options: SubagentSlotOptions;
  readonly resolve: (receipt: SubagentSlotReceipt) => void;
  readonly reject: (error: HarnessError) => void;
  readonly timer?: ReturnType<typeof setTimeout> | undefined;
}

export class SubagentPool {
  private readonly maxCapacity: number;
  private readonly activeSlots: Map<string, SubagentSlotReceipt> = new Map();
  private readonly waitQueue: QueuedRequest[] = [];
  private totalAcquiredCount = 0;
  private totalReleasedCount = 0;

  constructor(maxCapacity = MAX_SUBAGENT_CAPACITY) {
    this.maxCapacity = Math.max(1, maxCapacity);
  }

  public get capacity(): number {
    return this.maxCapacity;
  }

  public get activeCount(): number {
    return this.activeSlots.size;
  }

  public get queueDepth(): number {
    return this.waitQueue.length;
  }

  public getStats(): SubagentPoolStats {
    return {
      maxCapacity: this.maxCapacity,
      activeCount: this.activeSlots.size,
      queueDepth: this.waitQueue.length,
      totalAcquired: this.totalAcquiredCount,
      totalReleased: this.totalReleasedCount,
    };
  }

  public acquire(options?: SubagentSlotOptions): Promise<SubagentSlotReceipt> {
    const slotAgentId = options?.agentId ?? `agent_${Math.random().toString(36).slice(2, 9)}`;
    const slotRole = options?.role ?? "implementer";
    const slotTier = options?.tier ?? 3;
    const slotTaskId = options?.taskId;

    if (this.activeSlots.size < this.maxCapacity) {
      const receiptId = `slot_${crypto.randomUUID()}`;
      const receipt: SubagentSlotReceipt = {
        receiptId,
        agentId: slotAgentId,
        role: slotRole,
        tier: slotTier,
        ...(slotTaskId ? { taskId: slotTaskId } : {}),
        acquiredAt: new Date().toISOString(),
        activeCount: this.activeSlots.size + 1,
        release: () => {
          this.release(receiptId);
        },
      };

      this.activeSlots.set(receiptId, receipt);
      this.totalAcquiredCount += 1;
      return Promise.resolve(receipt);
    }

    if (this.waitQueue.length >= 1000) {
      throw new HarnessError(
        "CAPACITY_EXCEEDED",
        `subagent queue capacity exceeded: ${this.waitQueue.length} queued requests exceeds max 1000`,
      );
    }

    return new Promise<SubagentSlotReceipt>((resolve, reject) => {
      const queueId = `req_${crypto.randomUUID()}`;
      let timer: ReturnType<typeof setTimeout> | undefined;

      if (typeof options?.timeoutMs === "number" && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          const index = this.waitQueue.findIndex((entry) => entry.id === queueId);
          if (index !== -1) {
            this.waitQueue.splice(index, 1);
            reject(
              new HarnessError(
                "LOCK_TIMEOUT",
                `Subagent concurrency slot acquisition timed out after ${options.timeoutMs}ms (max capacity: ${this.maxCapacity}, queue depth: ${this.waitQueue.length})`,
              ),
            );
          }
        }, options.timeoutMs);
      }

      this.waitQueue.push({
        id: queueId,
        options: options ?? {},
        resolve,
        reject,
        timer,
      });
    });
  }

  public release(receiptOrId: SubagentSlotReceipt | string): boolean {
    const receiptId = typeof receiptOrId === "string" ? receiptOrId : receiptOrId.receiptId;

    if (!this.activeSlots.has(receiptId)) {
      return false;
    }

    this.activeSlots.delete(receiptId);
    this.totalReleasedCount += 1;

    if (this.waitQueue.length > 0) {
      const nextRequest = this.waitQueue.shift()!;
      if (nextRequest.timer) {
        clearTimeout(nextRequest.timer);
      }

      const nextReceiptId = `slot_${crypto.randomUUID()}`;
      const nextAgentId =
        nextRequest.options.agentId ?? `agent_${Math.random().toString(36).slice(2, 9)}`;
      const nextRole = nextRequest.options.role ?? "implementer";
      const nextTier = nextRequest.options.tier ?? 3;
      const nextTaskId = nextRequest.options.taskId;

      const nextReceipt: SubagentSlotReceipt = {
        receiptId: nextReceiptId,
        agentId: nextAgentId,
        role: nextRole,
        tier: nextTier,
        ...(nextTaskId ? { taskId: nextTaskId } : {}),
        acquiredAt: new Date().toISOString(),
        activeCount: this.activeSlots.size + 1,
        release: () => {
          this.release(nextReceiptId);
        },
      };

      this.activeSlots.set(nextReceiptId, nextReceipt);
      this.totalAcquiredCount += 1;
      nextRequest.resolve(nextReceipt);
    }

    return true;
  }

  public reset(): void {
    for (const item of this.waitQueue) {
      if (item.timer) {
        clearTimeout(item.timer);
      }
      item.reject(
        new HarnessError(
          "INVALID_STATE",
          "Subagent concurrency pool was reset while requests were waiting in queue",
        ),
      );
    }
    this.waitQueue.length = 0;
    this.activeSlots.clear();
    this.totalAcquiredCount = 0;
    this.totalReleasedCount = 0;
  }

  private static defaultInstance: SubagentPool | null = null;

  public static getInstance(): SubagentPool {
    if (!SubagentPool.defaultInstance) {
      SubagentPool.defaultInstance = new SubagentPool(MAX_SUBAGENT_CAPACITY);
    }
    return SubagentPool.defaultInstance;
  }

  public static resetInstance(): void {
    if (SubagentPool.defaultInstance) {
      SubagentPool.defaultInstance.reset();
      SubagentPool.defaultInstance = null;
    }
  }
}

export function acquireSubagentSlot(options?: SubagentSlotOptions): Promise<SubagentSlotReceipt> {
  return SubagentPool.getInstance().acquire(options);
}

export function releaseSubagentSlot(receiptOrId: SubagentSlotReceipt | string): boolean {
  return SubagentPool.getInstance().release(receiptOrId);
}

export function getSubagentPoolStats(): SubagentPoolStats {
  return SubagentPool.getInstance().getStats();
}

export function resetSubagentPool(): void {
  SubagentPool.resetInstance();
}
