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
  type VirtualFSSession,
  type VirtualMemoryFS,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  disableInMemorySessionStore,
  enableInMemorySessionStore,
  isInMemorySessionStoreEnabled,
} from "../../../../olt/scripts/src/authority/session/paths.ts";
import { getGrantRunFS, getGrantRunSession } from "../../validation/grants/grant-run-fixture.ts";

let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualAuthorityFS(): VirtualMemoryFS {
  if (!isInMemorySessionStoreEnabled()) {
    enableInMemorySessionStore();
  }
  const vfs = getGrantRunFS();
  const repoRoot = normPath(process.cwd());

  vfs.mkdirSync(repoRoot, { recursive: true });
  vfs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  vfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
  vfs.mkdirSync(path.join(repoRoot, ".olt", "scratch"), { recursive: true });

  vfs.chdir(repoRoot);
  return vfs;
}

export function cleanupVirtualAuthorityFS(): void {
  disableInMemorySessionStore();
  const vfs = getGrantRunFS();
  vfs.reset();
}

export function getVirtualAuthorityFS(): VirtualMemoryFS {
  return getGrantRunFS();
}

export function getVirtualAuthoritySession(): VirtualFSSession {
  return getGrantRunSession();
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
    const isAgentLifecycle =
      specification.name === "agent:register"
        ? true
        : specification.name === "agent:report"
          ? true
          : specification.name === "agent:release";
    if (isAgentLifecycle && name === "agent") {
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
  const effectiveCaller = caller !== undefined ? caller : testCaller(specification, flags);
  assertRawGrantedCommand(specification, flags, effectiveCaller);
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
