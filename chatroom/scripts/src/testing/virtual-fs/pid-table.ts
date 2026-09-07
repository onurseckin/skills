import type { ProcessRecord, ProcessSpawnOptions } from "./types.ts";

export class SyntheticPidTable {
  private readonly table = new Map<number, ProcessRecord>();
  private nextPid = 10000;

  constructor() {
    this.registerProcess(1, { alive: true, startTime: Date.now(), cmd: "init" });
  }

  registerProcess(pid: number, options?: ProcessSpawnOptions): ProcessRecord {
    const record: ProcessRecord = {
      pid,
      alive: options?.alive ?? true,
      startTime: options?.startTime ?? Date.now(),
      bootId: options?.bootId,
      cmd: options?.cmd,
    };
    this.table.set(pid, record);
    return record;
  }

  spawnProcess(options?: ProcessSpawnOptions): number {
    const pid = this.nextPid++;
    this.registerProcess(pid, options);
    return pid;
  }

  isProcessAlive(pid: number): boolean {
    const record = this.table.get(pid);
    return record !== undefined && record.alive;
  }

  getProcess(pid: number): ProcessRecord | undefined {
    return this.table.get(pid);
  }

  getProcessStartTime(pid: number): number | undefined {
    return this.table.get(pid)?.startTime;
  }

  killProcess(pid: number): boolean {
    const record = this.table.get(pid);
    if (!record) {
      return false;
    }
    this.table.set(pid, { ...record, alive: false });
    return true;
  }

  reset(): void {
    this.table.clear();
    this.nextPid = 10000;
    this.registerProcess(1, { alive: true, startTime: Date.now(), cmd: "init" });
  }

  listProcesses(): readonly ProcessRecord[] {
    return Array.from(this.table.values());
  }
}
