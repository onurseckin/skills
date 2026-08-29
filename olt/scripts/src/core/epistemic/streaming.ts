import type { EpistemicGrade } from "./types.ts";

export type EpistemicEventType =
  | "claim:registered"
  | "score:recalculated"
  | "contradiction:detected"
  | "grade:transition"
  | "threshold:breach"
  | "entropy:shifted"
  | "stream:heartbeat";

export interface EpistemicStreamEvent<T = Record<string, unknown>> {
  readonly id: string;
  readonly type: EpistemicEventType;
  readonly timestamp: number;
  readonly payload: T;
  readonly source?: string | undefined;
  readonly confidence?: number | undefined;
  readonly grade?: EpistemicGrade | undefined;
}

export interface StreamSubscription {
  readonly id: string;
  unsubscribe(): void;
  readonly active: boolean;
}

export type StreamSubscriber<T> = (event: T) => void | Promise<void>;
export type StreamErrorHandler = (error: Error) => void;

let subscriptionCounter = 0;

export class EpistemicEventStream<T = EpistemicStreamEvent> {
  private readonly subscribers = new Map<
    string,
    { subscriber: StreamSubscriber<T>; onError?: StreamErrorHandler | undefined; active: boolean }
  >();
  private closed = false;

  public subscribe(
    subscriber: StreamSubscriber<T>,
    onError?: StreamErrorHandler,
  ): StreamSubscription {
    if (this.closed) return { id: "closed", unsubscribe: () => {}, active: false };
    const id = `sub_${Date.now()}_${(subscriptionCounter += 1)}`;
    const record = { subscriber, onError, active: true };
    this.subscribers.set(id, record);

    return {
      id,
      get active() {
        return record.active;
      },
      unsubscribe: () => {
        record.active = false;
        this.subscribers.delete(id);
      },
    };
  }

  public emit(event: T): void {
    if (this.closed) return;
    for (const [id, target] of this.subscribers.entries()) {
      if (!target.active) {
        this.subscribers.delete(id);
        continue;
      }
      try {
        const res = target.subscriber(event);
        if (res instanceof Promise) {
          res.catch((err: unknown) => {
            target.onError?.(err instanceof Error ? err : new Error(String(err)));
          });
        }
      } catch (err: unknown) {
        target.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  public filter(predicate: (event: T) => boolean): EpistemicEventStream<T> {
    const downstream = new EpistemicEventStream<T>();
    this.subscribe((event) => {
      if (predicate(event)) downstream.emit(event);
    });
    return downstream;
  }

  public map<R>(transform: (event: T) => R): EpistemicEventStream<R> {
    const downstream = new EpistemicEventStream<R>();
    this.subscribe((event) => downstream.emit(transform(event)));
    return downstream;
  }

  public tap(fn: (event: T) => void): EpistemicEventStream<T> {
    const downstream = new EpistemicEventStream<T>();
    this.subscribe((event) => {
      fn(event);
      downstream.emit(event);
    });
    return downstream;
  }

  public take(count: number): EpistemicEventStream<T> {
    const downstream = new EpistemicEventStream<T>();
    let taken = 0;
    const sub = this.subscribe((event) => {
      if (taken < count) {
        taken += 1;
        downstream.emit(event);
        if (taken >= count) {
          sub.unsubscribe();
          downstream.close();
        }
      }
    });
    return downstream;
  }

  public debounce(waitMs: number): EpistemicEventStream<T> {
    const downstream = new EpistemicEventStream<T>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.subscribe((event) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => downstream.emit(event), waitMs);
    });
    return downstream;
  }

  public throttle(intervalMs: number): EpistemicEventStream<T> {
    const downstream = new EpistemicEventStream<T>();
    let lastEmit = 0;
    this.subscribe((event) => {
      const now = Date.now();
      if (now - lastEmit >= intervalMs) {
        lastEmit = now;
        downstream.emit(event);
      }
    });
    return downstream;
  }

  public sample(intervalMs: number): EpistemicEventStream<T> {
    const downstream = new EpistemicEventStream<T>();
    let lastSeen: T | undefined;
    let hasValue = false;
    const timer = setInterval(() => {
      if (hasValue && lastSeen !== undefined) {
        downstream.emit(lastSeen);
        hasValue = false;
      }
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();

    this.subscribe((event) => {
      lastSeen = event;
      hasValue = true;
    });
    return downstream;
  }

  public buffer(count: number): EpistemicEventStream<readonly T[]> {
    const downstream = new EpistemicEventStream<readonly T[]>();
    const bucket: T[] = [];
    this.subscribe((event) => {
      bucket.push(event);
      if (bucket.length >= count) {
        downstream.emit([...bucket]);
        bucket.length = 0;
      }
    });
    return downstream;
  }

  public subscriberCount(): number {
    return this.subscribers.size;
  }
  public isClosed(): boolean {
    return this.closed;
  }
  public close(): void {
    this.closed = true;
    this.subscribers.clear();
  }
}

export class EpistemicEventJournal {
  private readonly buffer: EpistemicStreamEvent[] = [];
  private readonly maxCapacity: number;

  constructor(maxCapacity = 1000) {
    this.maxCapacity = Math.max(1, maxCapacity);
  }

  public record(event: EpistemicStreamEvent): void {
    if (this.buffer.length >= this.maxCapacity) this.buffer.shift();
    this.buffer.push(event);
  }

  public getHistory(
    count?: number,
    filterType?: EpistemicEventType,
  ): readonly EpistemicStreamEvent[] {
    let list = this.buffer;
    if (filterType) list = list.filter((e) => e.type === filterType);
    if (count !== undefined && count > 0) return list.slice(-count);
    return [...list];
  }

  public size(): number {
    return this.buffer.length;
  }
  public clear(): void {
    this.buffer.length = 0;
  }
}

export class EpistemicEventBus {
  private readonly masterStream = new EpistemicEventStream<EpistemicStreamEvent>();
  private readonly typeStreams = new Map<
    EpistemicEventType,
    EpistemicEventStream<EpistemicStreamEvent>
  >();
  private readonly journal: EpistemicEventJournal;

  constructor(journalCapacity = 1000) {
    this.journal = new EpistemicEventJournal(journalCapacity);
  }

  public publish(event: EpistemicStreamEvent): void {
    this.journal.record(event);
    this.masterStream.emit(event);
    const typedStream = this.typeStreams.get(event.type);
    if (typedStream) typedStream.emit(event);
  }

  public on(
    eventType: EpistemicEventType | "*",
    subscriber: StreamSubscriber<EpistemicStreamEvent>,
    onError?: StreamErrorHandler,
  ): StreamSubscription {
    if (eventType === "*") return this.masterStream.subscribe(subscriber, onError);
    let stream = this.typeStreams.get(eventType);
    if (!stream) {
      stream = new EpistemicEventStream<EpistemicStreamEvent>();
      this.typeStreams.set(eventType, stream);
    }
    return stream.subscribe(subscriber, onError);
  }

  public stream(eventType?: EpistemicEventType | "*"): EpistemicEventStream<EpistemicStreamEvent> {
    if (!eventType || eventType === "*") return this.masterStream;
    let s = this.typeStreams.get(eventType);
    if (!s) {
      s = new EpistemicEventStream<EpistemicStreamEvent>();
      this.typeStreams.set(eventType, s);
    }
    return s;
  }

  public replay(count?: number, filterType?: EpistemicEventType): readonly EpistemicStreamEvent[] {
    return this.journal.getHistory(count, filterType);
  }

  public getJournal(): EpistemicEventJournal {
    return this.journal;
  }

  public clear(): void {
    this.journal.clear();
  }

  public close(): void {
    this.masterStream.close();
    for (const stream of this.typeStreams.values()) stream.close();
    this.typeStreams.clear();
    this.journal.clear();
  }
}
