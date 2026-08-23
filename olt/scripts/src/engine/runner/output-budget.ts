import { HarnessError } from "../../errors/harness-error.ts";

export class OutputBudget {
  private used = 0;

  public constructor(public readonly maximum: number) {}

  public claim(bytes: number): void {
    if (this.used + bytes > this.maximum) {
      throw new HarnessError(
        "INVALID_STATE",
        `combined command output quota exceeded (${this.maximum} bytes)`,
      );
    }
    this.used += bytes;
  }

  public get consumed(): number {
    return this.used;
  }
}
