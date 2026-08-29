import type { MuxEnvelope, StreamSource } from "./stream-sources.ts";

export type StreamSubscriber = (envelope: MuxEnvelope) => void;

export interface MultiplexerOptions {
  readonly maxBufferSize?: number | undefined;
}

export class StreamMultiplexer {
  private readonly sources: Map<string, StreamSource> = new Map();
  private readonly subscribers: Map<string, Set<StreamSubscriber>> = new Map();
  private readonly globalSubscribers: Set<StreamSubscriber> = new Set();
  private readonly ringBuffer: MuxEnvelope[] = [];
  private maxBufferSize: number;
  private sequenceCounter = 0;
  private droppedCount = 0;

  constructor(options?: MultiplexerOptions) {
    this.maxBufferSize = Math.max(1, options?.maxBufferSize ?? 500);
  }

  public registerSource(source: StreamSource): void {
    this.sources.set(source.channelName, source);
  }

  public unregisterSource(channelName: string): void {
    this.sources.delete(channelName);
  }

  public pushEvent<T>(
    channel: string,
    payload: T,
    actor = "system",
    kind = "custom_event",
    timestamp?: string,
  ): MuxEnvelope<T> {
    this.sequenceCounter += 1;
    const envelope: MuxEnvelope<T> = {
      id: `${channel}-${this.sequenceCounter}`,
      channel,
      timestamp: timestamp ?? new Date().toISOString(),
      sequence: this.sequenceCounter,
      actor,
      kind,
      payload,
    };

    this.appendEnvelope(envelope as MuxEnvelope);
    this.notifySubscribers(envelope as MuxEnvelope);
    return envelope;
  }

  public pollSources(): readonly MuxEnvelope[] {
    const newEnvelopes: MuxEnvelope[] = [];

    for (const source of this.sources.values()) {
      const events = source.pollNewEvents();
      for (const ev of events) {
        this.sequenceCounter += 1;
        const normalized: MuxEnvelope = {
          ...ev,
          sequence: this.sequenceCounter,
        };
        newEnvelopes.push(normalized);
        this.appendEnvelope(normalized);
        this.notifySubscribers(normalized);
      }
    }

    newEnvelopes.sort((a, b) => {
      const tsDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (tsDiff !== 0) return tsDiff;
      return a.sequence - b.sequence;
    });

    return newEnvelopes;
  }

  public subscribe(channel: string, subscriber: StreamSubscriber): () => void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    const channelSubs = this.subscribers.get(channel);
    if (channelSubs) {
      channelSubs.add(subscriber);
    }

    return () => {
      channelSubs?.delete(subscriber);
    };
  }

  public subscribeAll(subscriber: StreamSubscriber): () => void {
    this.globalSubscribers.add(subscriber);
    return () => {
      this.globalSubscribers.delete(subscriber);
    };
  }

  public getEvents(channel?: string, limit?: number): readonly MuxEnvelope[] {
    let filtered = channel ? this.ringBuffer.filter((e) => e.channel === channel) : this.ringBuffer;

    if (limit !== undefined && limit > 0 && filtered.length > limit) {
      filtered = filtered.slice(-limit);
    }
    return [...filtered];
  }

  public getEventsByActor(actor: string, limit?: number): readonly MuxEnvelope[] {
    let filtered = this.ringBuffer.filter((e) => e.actor === actor);
    if (limit !== undefined && limit > 0 && filtered.length > limit) {
      filtered = filtered.slice(-limit);
    }
    return [...filtered];
  }

  public clearBuffer(): void {
    this.ringBuffer.length = 0;
  }

  public getBufferSize(): number {
    return this.ringBuffer.length;
  }

  public getDroppedCount(): number {
    return this.droppedCount;
  }

  public setMaxBufferSize(size: number): void {
    this.maxBufferSize = Math.max(1, size);
    if (this.ringBuffer.length > this.maxBufferSize) {
      const excess = this.ringBuffer.length - this.maxBufferSize;
      this.droppedCount += excess;
      this.ringBuffer.splice(0, excess);
    }
  }

  private appendEnvelope(envelope: MuxEnvelope): void {
    this.ringBuffer.push(envelope);
    if (this.ringBuffer.length > this.maxBufferSize) {
      this.droppedCount += 1;
      this.ringBuffer.shift();
    }
  }

  private notifySubscribers(envelope: MuxEnvelope): void {
    const channelSubs = this.subscribers.get(envelope.channel);
    if (channelSubs) {
      for (const sub of channelSubs) {
        try {
          sub(envelope);
        } catch {}
      }
    }

    for (const sub of this.globalSubscribers) {
      try {
        sub(envelope);
      } catch {}
    }
  }
}
