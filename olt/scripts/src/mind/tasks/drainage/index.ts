export interface DrainableQueue<T> {
  enqueue(item: T): void;
  dequeue(): T | undefined;
  size(): number;
}

export class SimpleQueue<T> implements DrainableQueue<T> {
  private readonly items: T[];

  constructor(initialItems: readonly T[] = []) {
    this.items = [...initialItems];
  }

  public enqueue(item: T): void {
    this.items.push(item);
  }

  public dequeue(): T | undefined {
    return this.items.shift();
  }

  public size(): number {
    return this.items.length;
  }
}

export class QueueDrainage<T> {
  private readonly queue: DrainableQueue<T>;
  private readonly concurrencyLimit: number;

  constructor(queue: DrainableQueue<T>, concurrencyLimit: number = 1) {
    if (concurrencyLimit < 1) {
      throw new Error("Concurrency limit must be at least 1");
    }
    this.queue = queue;
    this.concurrencyLimit = concurrencyLimit;
  }

  public async drain(handler: (item: T) => Promise<void>): Promise<void> {
    const workers: Promise<void>[] = [];
    const runWorker = async (): Promise<void> => {
      while (this.queue.size() > 0) {
        const item = this.queue.dequeue();
        if (item === undefined) break;
        await handler(item);
      }
    };

    for (let i = 0; i < this.concurrencyLimit; i++) {
      workers.push(runWorker());
    }

    await Promise.all(workers);
  }
}
