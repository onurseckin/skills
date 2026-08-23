import { afterAll, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  loadRoleContract,
  type RoleContract,
} from "../../../olt/scripts/src/packets/role-contract.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import type { PacketRecord } from "../../../olt/scripts/src/workflow/types.ts";

/** Capsule roots the grant tests create; removed once the file that registered them is done. */
export function disposableRoots(): string[] {
  const roots: string[] = [];
  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });
  return roots;
}

export function packets(run: string): PacketRecord[] {
  const recorded = loadRun(run).state.packets;
  return recorded === undefined ? [] : (Object.values(recorded) as PacketRecord[]);
}

/** The packet the run published for one agent, with the contract bytes it was actually handed. */
export function publishedFor(
  run: string,
  agentId: string,
): { record: PacketRecord; markdown: string } {
  const record = packets(run).find(
    (packet) => packet.agent_id === agentId && packet.status === "published",
  );
  if (!record) throw new Error(`no published packet for ${agentId}`);
  return { record, markdown: readFileSync(join(run, record.markdown_path), "utf-8") };
}

export function expectCarriesContract(
  markdown: string,
  role: Parameters<typeof loadRoleContract>[0],
  // B12.2: a validator's packet now always carries its domain contract (standing checklist folded
  // in), not the bare role contract, so a caller checking a validator packet passes it in already
  // loaded rather than this function re-deriving which domain applied.
  contract: RoleContract = loadRoleContract(role),
) {
  expect(markdown).toContain("## Role contract");
  expect(markdown).toContain(contract.text.trim());
  // The document wraps long clauses; the parser joins them, so the comparison collapses whitespace.
  const flattened = markdown.replaceAll(/\s+/gu, " ");
  for (const clause of contract.must_not) expect(flattened).toContain(clause);
}

/** Mints a grant so dispatch enforcement has a recorded role to resolve the contract from. */
export async function registerGrant(run: string, agent: string, role: string): Promise<void> {
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    agent,
    "--role",
    role,
    "--host",
    "claude-code",
    "--actor",
    "coordinator",
  ]);
}
