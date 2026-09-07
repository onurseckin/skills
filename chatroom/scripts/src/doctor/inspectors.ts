import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LockReport, ManifestReport, ProvisionReport, ReaderHealthReport } from "./types.ts";

const PUBLIC_KEY_CONSTANT = "chatroom:public:v1";
const STALE_MS = 30000;

export function checkProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return typeof err === "object" && err !== null && "code" in err && err.code === "EPERM";
  }
}

export function resolveDataDir(override?: string): string {
  if (override !== undefined && override.length > 0) return override;
  const envHome = process.env["CHATROOM_HOME"];
  if (envHome !== undefined && envHome.length > 0) return envHome;
  const envDir = process.env["CHATROOM_DIR"];
  return envDir !== undefined && envDir.length > 0
    ? envDir
    : join(homedir(), ".agents", "chatroom");
}

export function readJsonSafely(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const res = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return typeof res === "object" && res !== null ? (res as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function inspectManifest(roomDir: string): ManifestReport {
  const p = join(roomDir, "room.json");
  if (!existsSync(p)) {
    return {
      exists: false,
      is_valid: false,
      id: null,
      title: null,
      visibility: null,
      key_fingerprint: null,
      created_at: null,
      errors: ["room.json does not exist"],
    };
  }
  const r = readJsonSafely(p);
  if (r === null) {
    return {
      exists: true,
      is_valid: false,
      id: null,
      title: null,
      visibility: null,
      key_fingerprint: null,
      created_at: null,
      errors: ["room.json is not valid JSON"],
    };
  }
  const errors: string[] = [];
  if (r["v"] !== 1) errors.push("room.json version must be 1");
  if (typeof r["id"] !== "string" || r["id"].length === 0)
    errors.push("room.json missing valid id");
  if (typeof r["title"] !== "string") errors.push("room.json missing valid title");
  if (r["visibility"] !== "keyed" && r["visibility"] !== "public")
    errors.push("room.json visibility must be keyed or public");
  if (typeof r["key_fingerprint"] !== "string")
    errors.push("room.json missing valid key_fingerprint");
  if (r["visibility"] === "public" && typeof r["key_fingerprint"] === "string") {
    const hash = createHash("sha256").update(PUBLIC_KEY_CONSTANT).digest("hex");
    const fp = r["key_fingerprint"];
    if (
      fp !== hash &&
      fp !== `sha256:${hash}` &&
      fp !== hash.slice(0, 8) &&
      fp !== `sha256:${hash.slice(0, 8)}`
    ) {
      errors.push("public room key_fingerprint does not match public constant");
    }
  }
  return {
    exists: true,
    is_valid: errors.length === 0,
    id: typeof r["id"] === "string" ? r["id"] : null,
    title: typeof r["title"] === "string" ? r["title"] : null,
    visibility: typeof r["visibility"] === "string" ? r["visibility"] : null,
    key_fingerprint: typeof r["key_fingerprint"] === "string" ? r["key_fingerprint"] : null,
    created_at: typeof r["created_at"] === "string" ? r["created_at"] : null,
    errors,
  };
}

export function resolveHeadSeq(roomDir: string): number {
  const indexJson = readJsonSafely(join(roomDir, "log.index.json"));
  if (indexJson !== null) {
    if (typeof indexJson["head_seq"] === "number") return indexJson["head_seq"];
    if (typeof indexJson["next_seq"] === "number") return Math.max(0, indexJson["next_seq"] - 1);
  }
  const logDir = join(roomDir, "log");
  if (!existsSync(logDir)) return 0;
  let maxSeq = 0;
  for (const f of readdirSync(logDir).filter((n) => n.endsWith(".jsonl"))) {
    try {
      for (const line of readFileSync(join(logDir, f), "utf-8").split("\n")) {
        if (line.trim().length === 0) continue;
        const p = JSON.parse(line) as Record<string, unknown>;
        if (typeof p["seq"] === "number" && p["seq"] > maxSeq) maxSeq = p["seq"];
      }
    } catch {
      continue;
    }
  }
  return maxSeq;
}

export function inspectMembers(roomDir: string): readonly string[] {
  const dir = join(roomDir, "members");
  if (!existsSync(dir)) return [];
  const members: string[] = [];
  for (const entry of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const r = readJsonSafely(join(dir, entry));
    if (r !== null && typeof r["id"] === "string" && r["id"].length > 0) members.push(r["id"]);
  }
  return members;
}

export function inspectLocks(
  roomDir: string,
  nowMs: number,
  aliveCheck: (pid: number) => boolean,
): readonly LockReport[] {
  const dir = join(roomDir, "locks");
  if (!existsSync(dir)) return [];
  const reports: LockReport[] = [];
  function scan(curr: string): void {
    for (const item of readdirSync(curr)) {
      const full = join(curr, item);
      const st = statSync(full);
      if (st.isDirectory()) {
        scan(full);
      } else if (item.endsWith(".lock")) {
        const parsed = readJsonSafely(full);
        const pid = parsed !== null && typeof parsed["pid"] === "number" ? parsed["pid"] : null;
        const holder =
          parsed !== null && typeof parsed["holder"] === "string" ? parsed["holder"] : null;
        let isStale = false;
        let reason: string | null = null;
        if (pid !== null) {
          if (!aliveCheck(pid)) {
            isStale = true;
            reason = "dead_process";
          }
        } else if (nowMs - st.mtimeMs > STALE_MS) {
          isStale = true;
          reason = "unparseable_stale_lock";
        }
        reports.push({
          path: full,
          name: item,
          pid,
          holder,
          is_stale: isStale,
          reason,
          mtime_ms: st.mtimeMs,
        });
      }
    }
  }
  scan(dir);
  return reports;
}

export function inspectProvisioning(
  roomDir: string,
  readers: readonly ReaderHealthReport[],
): readonly ProvisionReport[] {
  const dir = join(roomDir, "provision");
  if (!existsSync(dir)) return [];
  const reports: ProvisionReport[] = [];
  for (const file of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const full = join(dir, file);
    const parsed = readJsonSafely(full);
    const issues: string[] = [];
    let host = "";
    let member = "";
    let agentExists = false;
    if (parsed === null || parsed["v"] !== 1) {
      issues.push("corrupt provisioning receipt");
    } else {
      host = typeof parsed["host"] === "string" ? parsed["host"] : "";
      member = typeof parsed["member"] === "string" ? parsed["member"] : "";
      const rawArtifact =
        typeof parsed["agent_artifact"] === "string" && parsed["agent_artifact"].length > 0
          ? parsed["agent_artifact"]
          : typeof parsed["agent_path"] === "string" && parsed["agent_path"].length > 0
            ? parsed["agent_path"]
            : null;
      if (rawArtifact !== null) {
        agentExists = existsSync(rawArtifact);
        if (!agentExists) issues.push("communicator agent artifact missing");
      } else {
        issues.push("communicator agent artifact missing");
      }
    }
    const r = readers.find((item) => item.reader === member);
    const daemonAlive = r !== undefined && r.is_daemon_alive;
    if (r !== undefined && r.daemon_state === "STOPPED")
      issues.push("daemon is not live for provisioned member");
    reports.push({
      host,
      member,
      path: full,
      is_valid: issues.length === 0,
      agent_exists: agentExists,
      daemon_alive: daemonAlive,
      drift_detected: issues.length > 0,
      issues,
    });
  }
  return reports;
}

export function inspectQuarantined(roomDir: string): readonly string[] {
  const dir = join(roomDir, "quarantine");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => !n.startsWith("."));
}
