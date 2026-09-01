import { createHash } from "node:crypto";
import * as path from "node:path";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import type { CommandSpec } from "../../../../olt/scripts/src/cli/registry/types.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import {
  assertGrantedCommand as assertRawGrantedCommand,
  type AuthenticatedCaller,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  disableInMemorySessionStore,
  enableInMemorySessionStore,
} from "../../../../olt/scripts/src/authority/session/paths.ts";

let currentSession: VirtualFSSession | null = null;
let currentVfs: VirtualMemoryFS = new VirtualMemoryFS();
let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualAuthorityFS(): VirtualMemoryFS {
  enableInMemorySessionStore();
  if (!currentSession) {
    currentVfs = new VirtualMemoryFS();
    const repoRoot = normPath(process.cwd());

    currentVfs.mkdirSync(repoRoot, { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "scratch"), { recursive: true });

    currentVfs.chdir(repoRoot);
    currentSession = createVirtualFSSession(currentVfs);
  }
  return currentVfs;
}

export function cleanupVirtualAuthorityFS(): void {
  disableInMemorySessionStore();
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs.reset();
}

export function getVirtualAuthorityFS(): VirtualMemoryFS {
  return currentVfs;
}

export function scratchRoot(callerPath = "authority-test", label = "test"): string {
  const vfs = setupVirtualAuthorityFS();
  counter += 1;
  const digest = createHash("sha256")
    .update(`${callerPath}:${label}:${counter}`)
    .digest("hex")
    .slice(0, 8);
  const root = `/virtual/authority-scratch/${callerPath}-${label}-${counter}-${digest}`;
  vfs.mkdirSync(root, { recursive: true });
  return root;
}

export function spec(invocation: string): CommandSpec {
  const found = findCommand(invocation);
  if (!found) throw new Error(`the registry has no command named ${invocation}`);
  return found;
}

export function testCaller(
  specification: CommandSpec,
  flags: Flags,
): AuthenticatedCaller | undefined {
  const callerFlag = ["actor", "validator", "critic", "agent"].find((name) => {
    if (
      (specification.name === "agent:register" ||
        specification.name === "agent:report" ||
        specification.name === "agent:release") &&
      name === "agent"
    ) {
      return false;
    }
    return typeof flags[name] === "string" && (flags[name] as string).trim() !== "";
  });
  if (callerFlag === undefined) return undefined;
  return { actor: flags[callerFlag] as string, role: "test", verified: true };
}

export function assertGrantedCommand(
  specification: CommandSpec,
  flags: Flags,
  caller?: AuthenticatedCaller,
): void {
  assertRawGrantedCommand(specification, flags, caller ?? testCaller(specification, flags));
}

export function installMetaAuditGrant(
  run: string,
  id: string,
  role: string,
  status: "active" | "released" = "active",
): void {
  transact(run, "test-setup", "grant-agent", {}, (draft) => {
    draft.agents = [
      {
        id,
        role,
        parent_agent_id: null,
        parent_task_id: null,
        host: "test",
        granted_at: new Date().toISOString(),
        status,
      },
    ];
  });
}
