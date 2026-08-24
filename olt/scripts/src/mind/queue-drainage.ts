export interface DrainableQueue<T> {
  dequeue(): T | undefined;
  size(): number;
}

export class SimpleQueue<T> implements DrainableQueue<T> {
  private readonly items: T[] = [];

  constructor(initial: readonly T[] = []) {
    this.items = [...initial];
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
  constructor(
    private readonly queue: DrainableQueue<T>,
    private readonly concurrencyLimit: number,
  ) {
    if (concurrencyLimit < 1) {
      throw new Error("Concurrency limit must be at least 1");
    }
  }

  public async drain(processItem: (item: T) => Promise<void>): Promise<void> {
    const activePromises = new Set<Promise<void>>();

    while (this.queue.size() > 0 || activePromises.size > 0) {
      while (activePromises.size < this.concurrencyLimit && this.queue.size() > 0) {
        const item = this.queue.dequeue();
        if (item !== undefined) {
          const promise = processItem(item).finally(() => {
            activePromises.delete(promise);
          });
          activePromises.add(promise);
        }
      }

      if (activePromises.size > 0) {
        await Promise.race(activePromises);
      }
    }
  }
}
