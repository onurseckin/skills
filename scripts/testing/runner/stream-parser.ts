import {
  createDefaultRunnerStats,
  type RunnerStats,
  type StreamEvent,
  type StreamEventListener,
} from "./types.ts";

export function stripAnsi(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 27) {
      i++;
      if (i < text.length && text[i] === "[") {
        i++;
        while (i < text.length && text.charCodeAt(i) >= 32 && text.charCodeAt(i) <= 63) {
          i++;
        }
        if (i < text.length && text.charCodeAt(i) >= 64 && text.charCodeAt(i) <= 126) {
          i++;
        }
      } else if (i < text.length && text[i] === "(") {
        i += 2;
      }
    } else {
      result += text[i];
      i++;
    }
  }
  return result;
}

export function parseDurationMs(value: string, unit: string): number {
  const num = parseFloat(value);
  if (Number.isNaN(num)) return 0;
  if (unit === "s") return num * 1000;
  if (unit === "m") return num * 60 * 1000;
  return num;
}

export class StreamParser {
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private stats: RunnerStats = createDefaultRunnerStats();
  private listeners: StreamEventListener[] = [];
  private knownSuites = new Set<string>();

  public on(listener: StreamEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  public emit(event: StreamEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public getStats(): RunnerStats {
    return this.stats;
  }

  public getActiveSuite(): string | null {
    return this.stats.activeSuite;
  }

  public reset(): void {
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.stats = createDefaultRunnerStats();
    this.knownSuites.clear();
  }

  public feed(chunk: string | Uint8Array, stream: "stdout" | "stderr" = "stdout"): void {
    const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    if (stream === "stdout") {
      this.stdoutBuffer += text;
      this.processBuffer("stdout");
    } else {
      this.stderrBuffer += text;
      this.processBuffer("stderr");
    }
  }

  private processBuffer(stream: "stdout" | "stderr"): void {
    const buf = stream === "stdout" ? this.stdoutBuffer : this.stderrBuffer;
    const lines = buf.split(/\r?\n/);
    const lastElem = lines.pop();
    const remaining = lastElem !== undefined && lastElem !== null ? lastElem : "";
    if (stream === "stdout") {
      this.stdoutBuffer = remaining;
    } else {
      this.stderrBuffer = remaining;
    }

    for (const line of lines) {
      this.parseLine(line, stream);
    }
  }

  public flush(): void {
    if (this.stdoutBuffer.length > 0) {
      this.parseLine(this.stdoutBuffer, "stdout");
      this.stdoutBuffer = "";
    }
    if (this.stderrBuffer.length > 0) {
      this.parseLine(this.stderrBuffer, "stderr");
      this.stderrBuffer = "";
    }

    if (
      this.stats.suitesTotal > 0 &&
      this.stats.suitesPassed === 0 &&
      this.stats.suitesFailed === 0
    ) {
      this.stats.suitesPassed = this.stats.suitesTotal;
    } else if (this.stats.suitesTotal >= this.stats.suitesFailed) {
      this.stats.suitesPassed = this.stats.suitesTotal - this.stats.suitesFailed;
    }
  }

  public parseLine(line: string, stream: "stdout" | "stderr" = "stdout"): void {
    this.emit({ type: "raw_line", text: line, stream });
    const clean = stripAnsi(line).trim();
    if (!clean) return;

    const suiteMatch = clean.match(/^([^\s:]+\.(?:test|spec)\.[a-zA-Z0-9]+):$/);
    if (suiteMatch && suiteMatch[1]) {
      const file = suiteMatch[1];
      this.stats.activeSuite = file;
      if (!this.knownSuites.has(file)) {
        this.knownSuites.add(file);
        this.stats.suitesTotal++;
      }
      this.emit({ type: "suite_start", file });
      return;
    }

    const passMatch = clean.match(/^(?:\(pass\)|✓|\u2713)\s+(.*?)(?:\s+\[([\d.]+)(ms|s|m)\])?$/);
    if (passMatch && passMatch[1]) {
      const name = passMatch[1].trim();
      const dur =
        passMatch[2] && passMatch[3] ? parseDurationMs(passMatch[2], passMatch[3]) : undefined;
      this.stats.testsPassed++;
      this.stats.testsTotal++;
      const currentSuite =
        this.stats.activeSuite !== null && this.stats.activeSuite !== undefined
          ? this.stats.activeSuite
          : "unknown";
      this.emit({
        type: "test_pass",
        suite: currentSuite,
        name,
        durationMs: dur,
      });
      return;
    }

    const failMatch = clean.match(/^(?:\(fail\)|✗|\u2717)\s+(.*?)(?:\s+\[([\d.]+)(ms|s|m)\])?$/);
    if (failMatch && failMatch[1]) {
      const name = failMatch[1].trim();
      const dur =
        failMatch[2] && failMatch[3] ? parseDurationMs(failMatch[2], failMatch[3]) : undefined;
      const suite =
        this.stats.activeSuite !== null && this.stats.activeSuite !== undefined
          ? this.stats.activeSuite
          : "unknown";
      this.stats.testsFailed++;
      this.stats.testsTotal++;
      this.stats.failedTests.push({ suite, test: name, durationMs: dur });
      if (this.stats.activeSuite && !this.stats.failedSuites.includes(this.stats.activeSuite)) {
        this.stats.failedSuites.push(this.stats.activeSuite);
        this.stats.suitesFailed++;
      }
      this.emit({
        type: "test_fail",
        suite,
        name,
        durationMs: dur,
      });
      return;
    }

    const skipMatch = clean.match(/^(?:\(skip\)|\(todo\)|~)\s+(.*?)(?:\s+\[([\d.]+)(ms|s|m)\])?$/);
    if (skipMatch && skipMatch[1]) {
      const name = skipMatch[1].trim();
      this.stats.testsSkipped++;
      this.stats.testsTotal++;
      const currentSuite =
        this.stats.activeSuite !== null && this.stats.activeSuite !== undefined
          ? this.stats.activeSuite
          : "unknown";
      this.emit({
        type: "test_skip",
        suite: currentSuite,
        name,
      });
      return;
    }

    const sumPassMatch = clean.match(/^(\d+)\s+pass$/);
    if (sumPassMatch && sumPassMatch[1]) {
      this.stats.testsPassed = parseInt(sumPassMatch[1], 10);
      return;
    }

    const sumFailMatch = clean.match(/^(\d+)\s+fail$/);
    if (sumFailMatch && sumFailMatch[1]) {
      this.stats.testsFailed = parseInt(sumFailMatch[1], 10);
      return;
    }

    const expectMatch = clean.match(/^(\d+)\s+expect\(\)\s+calls$/);
    if (expectMatch && expectMatch[1]) {
      this.stats.expectCalls = parseInt(expectMatch[1], 10);
      return;
    }

    const ranMatch = clean.match(
      /^Ran\s+(\d+)\s+tests\s+across\s+(\d+)\s+files\.\s+\[([\d.]+)(ms|s|m)\]$/,
    );
    if (ranMatch && ranMatch[1] && ranMatch[2] && ranMatch[3] && ranMatch[4]) {
      this.stats.testsTotal = parseInt(ranMatch[1], 10);
      this.stats.suitesTotal = parseInt(ranMatch[2], 10);
      this.stats.durationMs = parseDurationMs(ranMatch[3], ranMatch[4]);
      this.stats.suitesPassed = Math.max(0, this.stats.suitesTotal - this.stats.suitesFailed);
      this.emit({
        type: "summary",
        pass: this.stats.testsPassed,
        fail: this.stats.testsFailed,
        expectCalls: this.stats.expectCalls,
        totalDurationMs: this.stats.durationMs,
      });
      return;
    }
  }
}
