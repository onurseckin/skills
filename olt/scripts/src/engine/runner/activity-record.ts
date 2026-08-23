import { join } from "node:path";
import { atomicWriteJson } from "../../core/durable-write.ts";

type Channel = "stderr" | "stdout";

export class ActivityRecord {
  public readonly path: string;
  private heartbeatAt: string;
  private lastOutputAt: null | string = null;
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private lastPersisted: number;

  public constructor(
    directory: string,
    private readonly commandId: string,
    private readonly attempt: number,
    private readonly startedAt: string,
    private readonly intervalMs: number,
  ) {
    this.path = join(directory, "activity.json");
    this.heartbeatAt = startedAt;
    this.lastPersisted = new Date(startedAt).valueOf();
    this.persist("running");
  }

  public heartbeat(at = new Date()): void {
    this.maybePersist(at);
  }

  public output(channel: Channel, bytes: number, at = new Date()): void {
    const timestamp = at.toISOString();
    this.lastOutputAt = timestamp;
    if (channel === "stdout") this.stdoutBytes += bytes;
    else this.stderrBytes += bytes;
    this.maybePersist(at);
  }

  private maybePersist(at: Date): void {
    if (at.valueOf() - this.lastPersisted < this.intervalMs) return;
    this.heartbeatAt = at.toISOString();
    this.lastPersisted = at.valueOf();
    this.persist("running");
  }

  public complete(status: "completed" | "failed" = "completed", at = new Date()): void {
    this.heartbeatAt = at.toISOString();
    this.persist(status, this.heartbeatAt);
  }

  private persist(status: "completed" | "failed" | "running", finishedAt?: string): void {
    atomicWriteJson(
      this.path,
      {
        schema: "harness.command-activity",
        version: 1,
        command_id: this.commandId,
        attempt: this.attempt,
        status,
        started_at: this.startedAt,
        heartbeat_at: this.heartbeatAt,
        last_output_at: this.lastOutputAt,
        stdout_bytes: this.stdoutBytes,
        stderr_bytes: this.stderrBytes,
        ...(finishedAt === undefined ? {} : { finished_at: finishedAt }),
      },
      0o600,
    );
  }
}
