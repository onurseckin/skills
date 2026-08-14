import { inspectFailureText, type FailureSignals } from "./classify-failure.ts";

export class FailureEvidence {
  private overlap = "";
  private readonly found: FailureSignals = {
    authorization: false,
    networkTransient: false,
    testFailure: false,
  };

  public ingest(text: string): void {
    const combined = `${this.overlap}${text}`;
    const observed = inspectFailureText(combined);
    this.found.authorization ||= observed.authorization;
    this.found.networkTransient ||= observed.networkTransient;
    this.found.testFailure ||= observed.testFailure;
    this.overlap = combined.slice(-128);
  }

  public snapshot(): FailureSignals {
    return { ...this.found };
  }
}
