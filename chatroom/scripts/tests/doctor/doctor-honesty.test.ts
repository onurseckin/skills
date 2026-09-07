import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import { daemonHealthPath } from "../../src/core/index.ts";
import {
  computeDaemonState,
  createInitialHealthRecord,
  inspectDaemon,
  writeHealthRecord,
  type DaemonHealthRecord,
  type HealthPorts,
} from "../../src/daemon/index.ts";
import { inspectProvisioning, type InspectorPorts } from "../../src/doctor/index.ts";
import { verifyProvisionReceipt, type ProvisionReceipt } from "../../src/provision/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

const ROOM = "room-doctor";
const READER = "reader-1";
const HEALTH_PATH = daemonHealthPath(ROOM, READER);
const NOW_ISO = "2026-09-07T14:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function makeHealthPorts(vfs: ChatVirtualFS): HealthPorts {
  return {
    existsSync: (path: string) => vfs.existsSync(path),
    readFileSync: (path: string, encoding: string) => vfs.readFileSync(path, encoding) as string,
    writeFileSync: (path: string, content: string) => {
      vfs.mkdirSync(dirname(path), { recursive: true });
      vfs.writeFileSync(path, content);
    },
    writeAtomic: (path: string, content: string) => {
      vfs.mkdirSync(dirname(path), { recursive: true });
      vfs.writeFileSync(path, content);
    },
    isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
  };
}

function makeInspectorPorts(vfs: ChatVirtualFS): InspectorPorts {
  return {
    existsSync: (path: string) => vfs.existsSync(path),
    readdirSync: (path: string) => vfs.readdirSync(path),
    readFileSync: (path: string, encoding?: string) =>
      vfs.readFileSync(path, encoding ?? "utf-8") as string,
  };
}

describe("Doctor daemon liveness and dynamic state derivation", () => {
  it("reports daemon as IDLE when process is alive regardless of stale stored STOPPED string", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const ports = makeHealthPorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const freshWake = new Date().toISOString();
    const initial = createInitialHealthRecord(ROOM, READER, livePid, freshWake, "boot-1", 750);
    const staleStored: DaemonHealthRecord = {
      ...initial,
      state: "STOPPED",
      last_wake_at: freshWake,
      last_delivered_seq: 10,
      room_head_seq: 10,
      lag_seqs: 0,
    };
    writeHealthRecord(HEALTH_PATH, staleStored, ports);

    const derived = computeDaemonState(staleStored, NOW_MS, {
      isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
    });
    expect(derived).toBe("IDLE");

    const inspection = inspectDaemon(
      ROOM,
      READER,
      {
        isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
      },
      ports,
    );

    expect(inspection.state).toBe("IDLE");
    expect(inspection.health?.pid).toBe(livePid);
  });

  it("reports daemon as STOPPED when recorded process PID is dead", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const ports = makeHealthPorts(vfs);
    const deadPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const initial = createInitialHealthRecord(ROOM, READER, deadPid, NOW_ISO, "boot-dead", 750);
    const record: DaemonHealthRecord = {
      ...initial,
      state: "LIVE",
      last_wake_at: NOW_ISO,
    };
    writeHealthRecord(HEALTH_PATH, record, ports);
    vfs.killProcess(deadPid);

    const inspection = inspectDaemon(
      ROOM,
      READER,
      {
        isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
      },
      ports,
    );

    expect(inspection.state).toBe("STOPPED");
  });
});

describe("Doctor provisioning receipt honesty and drift verification", () => {
  function makeReceipt(overrides: Partial<ProvisionReceipt> = {}): ProvisionReceipt {
    return {
      v: 1,
      host: "antigravity",
      member: "alice",
      room: ROOM,
      agent_name: "alice",
      agent_artifact: "/agents/alice.json",
      cron: {
        mechanism: "schedule",
        expression: "*/5 * * * *",
        cadence_seconds: 300,
        configPath: "/schedules/communicator-alice.json",
      },
      daemon: {
        started_at: NOW_ISO,
        pid: 12345,
      },
      runtime_command: "chat:daemon --tick",
      created_at: NOW_ISO,
      ...overrides,
    };
  }

  it("detects drift when communicator agent artifact is missing", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const inspectorPorts = makeInspectorPorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const receipt = makeReceipt({
      agent_artifact: "/nonexistent/agent.json",
      daemon: { started_at: NOW_ISO, pid: livePid },
      cron: { mechanism: "self_watchdog", expression: null, cadence_seconds: 300 },
    });

    const receiptDir = `/rooms/${ROOM}/provision`;
    vfs.mkdirSync(receiptDir, { recursive: true });
    vfs.writeFileSync(`${receiptDir}/antigravity.alice.json`, JSON.stringify(receipt, null, 2));

    const reports = inspectProvisioning(
      `/rooms/${ROOM}`,
      [],
      (pid: number) => vfs.isProcessAlive(pid),
      inspectorPorts,
    );

    expect(reports.length).toBe(1);
    const rep = reports[0];
    expect(rep).toBeDefined();
    if (!rep) return;
    expect(rep.is_valid).toBe(false);
    expect(rep.agent_exists).toBe(false);
    expect(rep.drift_detected).toBe(true);
    expect(rep.issues).toContain("communicator agent artifact missing");
  });

  it("detects drift when receipt daemon process is dead", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const inspectorPorts = makeInspectorPorts(vfs);
    const deadPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    vfs.killProcess(deadPid);

    vfs.mkdirSync("/agents", { recursive: true });
    vfs.writeFileSync("/agents/alice.json", "{}");

    const receipt = makeReceipt({
      agent_artifact: "/agents/alice.json",
      daemon: { started_at: NOW_ISO, pid: deadPid },
      cron: { mechanism: "self_watchdog", expression: null, cadence_seconds: 300 },
    });

    const receiptDir = `/rooms/${ROOM}/provision`;
    vfs.mkdirSync(receiptDir, { recursive: true });
    vfs.writeFileSync(`${receiptDir}/antigravity.alice.json`, JSON.stringify(receipt, null, 2));

    const reports = inspectProvisioning(
      `/rooms/${ROOM}`,
      [],
      (pid: number) => vfs.isProcessAlive(pid),
      inspectorPorts,
    );

    expect(reports.length).toBe(1);
    const rep = reports[0];
    expect(rep).toBeDefined();
    if (!rep) return;
    expect(rep.is_valid).toBe(false);
    expect(rep.daemon_alive).toBe(false);
    expect(rep.cron_verified).toBe(false);
    expect(rep.drift_detected).toBe(true);
    expect(rep.issues).toContain(`receipt claims daemon pid ${deadPid}, process is dead`);
    expect(rep.issues).toContain("receipt claims self_watchdog, daemon process is dead");
  });

  it("detects drift when cron mechanism is none", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const inspectorPorts = makeInspectorPorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    vfs.mkdirSync("/agents", { recursive: true });
    vfs.writeFileSync("/agents/alice.json", "{}");

    const receipt = makeReceipt({
      agent_artifact: "/agents/alice.json",
      daemon: { started_at: NOW_ISO, pid: livePid },
      cron: { mechanism: "none", expression: null, cadence_seconds: 0 },
    });

    const receiptDir = `/rooms/${ROOM}/provision`;
    vfs.mkdirSync(receiptDir, { recursive: true });
    vfs.writeFileSync(`${receiptDir}/antigravity.alice.json`, JSON.stringify(receipt, null, 2));

    const reports = inspectProvisioning(
      `/rooms/${ROOM}`,
      [],
      (pid: number) => vfs.isProcessAlive(pid),
      inspectorPorts,
    );

    expect(reports.length).toBe(1);
    const rep = reports[0];
    expect(rep).toBeDefined();
    if (!rep) return;
    expect(rep.cron_verified).toBe(false);
    expect(rep.issues).toContain("no scheduled wake mechanism configured");
  });

  it("detects drift when cron mechanism is schedule but registration file is missing on host", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const inspectorPorts = makeInspectorPorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    vfs.mkdirSync("/agents", { recursive: true });
    vfs.writeFileSync("/agents/alice.json", "{}");

    const receipt = makeReceipt({
      agent_artifact: "/agents/alice.json",
      daemon: { started_at: NOW_ISO, pid: livePid },
      cron: {
        mechanism: "schedule",
        expression: "*/5 * * * *",
        cadence_seconds: 300,
        configPath: "/schedules/communicator-alice.json",
      },
    });

    const receiptDir = `/rooms/${ROOM}/provision`;
    vfs.mkdirSync(receiptDir, { recursive: true });
    vfs.writeFileSync(`${receiptDir}/antigravity.alice.json`, JSON.stringify(receipt, null, 2));

    const reports = inspectProvisioning(
      `/rooms/${ROOM}`,
      [],
      (pid: number) => vfs.isProcessAlive(pid),
      inspectorPorts,
    );

    expect(reports.length).toBe(1);
    const rep = reports[0];
    expect(rep).toBeDefined();
    if (!rep) return;
    expect(rep.cron_verified).toBe(false);
    expect(rep.issues).toContain(
      "receipt claims cron schedule, registration missing or not found on host",
    );
  });

  it("detects drift when configPath is null or missing on a non-self_watchdog receipt", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const inspectorPorts = makeInspectorPorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    vfs.mkdirSync("/agents", { recursive: true });
    vfs.writeFileSync("/agents/alice.json", "{}");

    const receipt = makeReceipt({
      agent_artifact: "/agents/alice.json",
      daemon: { started_at: NOW_ISO, pid: livePid },
      cron: {
        mechanism: "schedule",
        expression: "*/5 * * * *",
        cadence_seconds: 300,
        configPath: null,
      },
    });

    const receiptDir = `/rooms/${ROOM}/provision`;
    vfs.mkdirSync(receiptDir, { recursive: true });
    vfs.writeFileSync(`${receiptDir}/antigravity.alice.json`, JSON.stringify(receipt, null, 2));

    const reports = inspectProvisioning(
      `/rooms/${ROOM}`,
      [],
      (pid: number) => vfs.isProcessAlive(pid),
      inspectorPorts,
    );

    expect(reports.length).toBe(1);
    const rep = reports[0];
    expect(rep).toBeDefined();
    if (!rep) return;
    expect(rep.cron_verified).toBe(false);
    expect(rep.issues).toContain("receipt does not record where cron was installed");
  });

  it("verifies receipt through verifyProvisionReceipt API", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    vfs.mkdirSync("/agents", { recursive: true });
    vfs.writeFileSync("/agents/alice.json", "{}");

    const aliveCheck = (pid: number): boolean => vfs.isProcessAlive(pid);
    const existsCheck = (path: string): boolean => vfs.existsSync(path);

    const noneReceipt = makeReceipt({
      agent_artifact: "/agents/alice.json",
      daemon: { started_at: NOW_ISO, pid: livePid },
      cron: { mechanism: "none", expression: null, cadence_seconds: 0 },
    });
    const noneRes = verifyProvisionReceipt(noneReceipt, {
      checkProcessAlive: aliveCheck,
      existsSync: existsCheck,
    });
    expect(noneRes.valid).toBe(false);
    expect(noneRes.reason).toBe("no scheduled wake mechanism configured");

    const deadPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    vfs.killProcess(deadPid);
    const deadDaemonReceipt = makeReceipt({
      agent_artifact: "/agents/alice.json",
      daemon: { started_at: NOW_ISO, pid: deadPid },
      cron: { mechanism: "self_watchdog", expression: null, cadence_seconds: 300 },
    });
    const deadRes = verifyProvisionReceipt(deadDaemonReceipt, {
      checkProcessAlive: aliveCheck,
      existsSync: existsCheck,
    });
    expect(deadRes.valid).toBe(false);
    expect(deadRes.reason).toBe(`receipt claims daemon pid ${deadPid}, process is dead`);

    const validReceipt = makeReceipt({
      agent_artifact: "/agents/alice.json",
      daemon: { started_at: NOW_ISO, pid: livePid },
      cron: { mechanism: "self_watchdog", expression: null, cadence_seconds: 300 },
    });
    const validRes = verifyProvisionReceipt(validReceipt, {
      checkProcessAlive: aliveCheck,
      existsSync: existsCheck,
    });
    expect(validRes.valid).toBe(true);
  });
});
