export class SyntheticClock {
  private currentMs: number;

  constructor(initialMs: number = Date.now()) {
    this.currentMs = initialMs;
  }

  now(): number {
    return this.currentMs;
  }

  iso(): string {
    return new Date(this.currentMs).toISOString();
  }

  advance(deltaMs: number): void {
    if (deltaMs < 0) {
      throw new Error("Clock cannot move backwards");
    }
    this.currentMs += deltaMs;
  }

  setTime(absoluteMs: number): void {
    this.currentMs = absoluteMs;
  }

  reset(initialMs: number = Date.now()): void {
    this.currentMs = initialMs;
  }
}
