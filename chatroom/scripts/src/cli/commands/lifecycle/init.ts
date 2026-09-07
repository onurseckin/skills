import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "../shared/index.ts";
import { assertValidRoomId, ChatError, isProcessAlive } from "../../../core/index.ts";
import {
  addMember,
  createRoom,
  readRoomKey,
  readRoomManifest,
  roomManifestExists,
  rotateRoomKey,
  writeRepoBinding,
  type RosterOptions,
} from "../../../room/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";
import {
  consumeInvite,
  mintInvite,
  parseInviteUri,
  validateInvite,
} from "../../../handshake/index.ts";
import { ensureDaemon, startDaemon } from "../../../daemon/index.ts";
import {
  detectHost,
  generateCommunicatorAgent,
  wireCron,
  writeProvisionReceipt,
  type SupportedHost,
} from "../../../provision/index.ts";
import { resolvePolicy } from "../../../policy/index.ts";

export const initCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, [
    "room",
    "title",
    "as",
    "host",
    "public",
    "invite",
    "repo",
    "no-agent",
    "no-daemon",
    "print-invite",
    "rotate-key",
    "json",
    "writeFile",
  ]);

  const roomFlag = textFlag(flags, "room", false);
  const titleFlag = textFlag(flags, "title", false);
  const asFlag = textFlag(flags, "as", false);
  const hostFlag = textFlag(flags, "host", false);
  const publicFlag = boolFlag(flags, "public");
  const inviteFlag = textFlag(flags, "invite", false);
  const repoFlag = textFlag(flags, "repo", false);
  const noAgentFlag = boolFlag(flags, "no-agent");
  const noDaemonFlag = boolFlag(flags, "no-daemon");
  const printInviteFlag = boolFlag(flags, "print-invite");
  const rotateKeyFlag = boolFlag(flags, "rotate-key");
  const jsonFlag = boolFlag(flags, "json");

  let targetRoom: string;
  let inviteCode: string | undefined;
  if (inviteFlag !== undefined) {
    const parsed = parseInviteUri(inviteFlag);
    targetRoom = parsed.roomId;
    inviteCode = parsed.code;
  } else if (roomFlag !== undefined) {
    assertValidRoomId(roomFlag);
    targetRoom = roomFlag;
  } else {
    throw new ChatError("INVALID_ARGUMENT", "--room or --invite is required");
  }

  const repoRoot = repoFlag !== undefined ? path.resolve(repoFlag) : process.cwd();
  const detectedHost: SupportedHost =
    hostFlag !== undefined && hostFlag !== "auto"
      ? (hostFlag as SupportedHost)
      : detectHost({ repoRoot, env: process.env });

  const resolvedMemberId =
    asFlag !== undefined ? asFlag : `${detectedHost}-${path.basename(repoRoot)}`;
  const identity = resolveIdentity({
    as: resolvedMemberId,
    host: detectedHost,
    repoRoot,
    cwd: repoRoot,
  });

  try {
    ensureDaemon(targetRoom, identity.id, { autoStart: false });
  } catch {}

  const policy = resolvePolicy({ repoRoot });

  const rosterOptions: RosterOptions | undefined =
    typeof flags["writeFile"] === "function"
      ? { writeFile: flags["writeFile"] as (filePath: string, content: string) => void }
      : (_context as { readonly rosterOptions?: RosterOptions })?.rosterOptions;

  let tokenConsumed = false;
  try {
    if (inviteFlag !== undefined) {
      if (rotateKeyFlag) {
        throw new ChatError("INVALID_ARGUMENT", "--rotate-key cannot be used with --invite");
      }
      const validated = validateInvite(inviteFlag);
      const chatroomDir =
        process.env["CHATROOM_HOME"] ?? path.join(os.homedir(), ".agents", "chatroom");
      const keyPath = path.join(chatroomDir, "keys", `${targetRoom}.key`);
      if (!fs.existsSync(keyPath)) {
        const dir = path.dirname(keyPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const keyString =
          validated.key.length === 32
            ? Buffer.from(validated.key).toString("hex")
            : Buffer.from(validated.key).toString("utf8");
        fs.writeFileSync(keyPath, keyString + "\n", { mode: 0o600 });
      }
    } else if (!roomManifestExists(targetRoom)) {
      createRoom({
        id: targetRoom,
        title: titleFlag !== undefined ? titleFlag : targetRoom,
        visibility: publicFlag ? "public" : "keyed",
        createdBy: identity.id,
      });
    } else if (rotateKeyFlag) {
      process.stderr.write(
        `Warning: rotating room key for '${targetRoom}' invalidates outstanding invites.\n`,
      );
      rotateRoomKey(targetRoom);
    } else {
      readRoomKey(targetRoom);
    }

    addMember(
      targetRoom,
      {
        id: identity.id,
        display_name: titleFlag,
        role: identity.role,
        host: identity.host,
        repo_hint: repoRoot,
      },
      rosterOptions,
    );

    if (inviteFlag !== undefined) {
      consumeInvite(inviteFlag, identity.id);
      tokenConsumed = true;
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const statusStr = tokenConsumed ? "consumed" : "preserved (unconsumed)";
    const inviteInfo = inviteCode !== undefined ? ` with invite '${inviteCode}'` : "";
    throw new ChatError(
      "JOIN_FAILED",
      `Failed to initialize room '${targetRoom}'${inviteInfo}: ${errorMsg}. Token status: ${statusStr}.`,
    );
  }

  writeRepoBinding(repoRoot, {
    member_id: identity.id,
    room_id: targetRoom,
    host: detectedHost,
  });

  let agentName = "";
  let agentArtifact = "";
  if (!noAgentFlag) {
    const agentResult = generateCommunicatorAgent({
      host: detectedHost,
      room: targetRoom,
      ...(titleFlag !== undefined ? { title: titleFlag } : {}),
      repoRoot,
    });
    agentName = agentResult.agentName;
    agentArtifact = agentResult.artifactPath;
  }

  let cronResult: {
    readonly mechanism: "schedule" | "settings_hooks" | "notify_hook" | "self_watchdog";
    readonly expression: string | null;
    readonly cadence_seconds: number;
  } = {
    mechanism: "self_watchdog",
    expression: null,
    cadence_seconds: 300,
  };

  if (!noAgentFlag && !noDaemonFlag) {
    const wired = wireCron({ host: detectedHost, room: targetRoom, repoRoot });
    cronResult = {
      mechanism: wired.mechanism,
      expression: wired.expression ?? null,
      cadence_seconds: wired.cadence_seconds,
    };
  }

  let daemonPid: number | null = null;
  if (!noDaemonFlag) {
    const daemonRes = startDaemon({
      room: targetRoom,
      reader: identity.id,
      host: detectedHost,
      policy,
    });
    if (
      daemonRes.status === "failed" ||
      daemonRes.pid === null ||
      daemonRes.pid === undefined ||
      !isProcessAlive(daemonRes.pid)
    ) {
      throw new ChatError(
        "DAEMON_SPAWN_FAILED",
        `Daemon failed to start for room '${targetRoom}': ${daemonRes.reason ?? "process not alive"}`,
      );
    }
    daemonPid = daemonRes.pid;
  }

  writeProvisionReceipt({
    v: 1,
    host: detectedHost,
    member: identity.id,
    room: targetRoom,
    agent_name: agentName,
    agent_artifact: agentArtifact,
    cron: cronResult,
    daemon: {
      started_at: new Date().toISOString(),
      pid: daemonPid ?? 0,
    },
    runtime_command: policy.runtime_command,
    created_at: new Date().toISOString(),
  });

  let printedInvite: string | undefined = undefined;
  if (printInviteFlag) {
    const manifest = readRoomManifest(targetRoom);
    if (manifest.visibility !== "public") {
      printedInvite = mintInvite(targetRoom, identity.id, 3600);
    }
  }

  const result: Record<string, unknown> = {
    room: targetRoom,
    as: identity.id,
    host: detectedHost,
    daemon_pid: daemonPid,
    agent_name: agentName.length > 0 ? agentName : undefined,
    invite: printedInvite,
    status: "provisioned",
  };

  if (!jsonFlag) {
    process.stdout.write(`Room: ${targetRoom}\n`);
    process.stdout.write(`Member: ${identity.id}\n`);
    process.stdout.write(`Host: ${detectedHost}\n`);
    process.stdout.write(`Daemon PID: ${daemonPid !== null ? String(daemonPid) : "none"}\n`);
    if (printedInvite !== undefined) {
      process.stdout.write(`Invite: ${printedInvite}\n`);
    }
  }

  return result;
};
