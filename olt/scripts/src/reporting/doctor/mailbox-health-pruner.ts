import {
  existsSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  healCorruptedCursor,
  inspectCursor,
  listAgentDirs,
  resolveActiveAgentSet,
  resolveMailboxRoot,
  type MailboxHealthOptions,
} from "./mailbox-health-helpers.ts";

export function pruneOrphanedMailboxes(options: MailboxHealthOptions = {}): readonly string[] {
  const pruned: string[] = [];
  const mailboxesDir = resolveMailboxRoot(options);
  const activeSet = options.activeAgentIds ? new Set(options.activeAgentIds) : null;
  const now = Date.now();
  for (const agentId of listAgentDirs(mailboxesDir)) {
    const agentDir = join(mailboxesDir, agentId);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(agentDir).mtimeMs;
    } catch {
      continue;
    }
    let isOrphaned = activeSet !== null ? !activeSet.has(agentId) : (now - mtimeMs) / 1000 > 3600;
    if (activeSet === null && options.state && typeof options.state === "object") {
      const agents = options.state.agents as Record<string, unknown> | undefined;
      const tasks = options.state.tasks as Record<string, unknown> | undefined;
      isOrphaned =
        !((agents && agentId in agents) || (tasks && agentId in tasks)) &&
        (now - mtimeMs) / 1000 > 3600;
    }
    if (isOrphaned) {
      const toArchive: string[] = [];
      for (const f of ["inbox.jsonl", "outbox.jsonl"]) {
        const p = join(agentDir, f);
        if (existsSync(p)) {
          try {
            const c = readFileSync(p, "utf8").trim();
            if (c.length > 0) toArchive.push(c);
            unlinkSync(p);
          } catch {}
        }
      }
      if (toArchive.length > 0) {
        const arc = join(agentDir, "archive.jsonl");
        try {
          const exist = existsSync(arc) ? readFileSync(arc, "utf8") : "";
          writeFileSync(arc, `${(exist.trim() + "\n" + toArchive.join("\n")).trim()}\n`, "utf8");
        } catch {}
      }
      try {
        if (readdirSync(agentDir).length === 0) rmdirSync(agentDir);
      } catch {}
      pruned.push(`Pruned orphaned mailbox '${agentId}'`);
    }
  }
  return pruned;
}

export function autoHealMailboxState(options: MailboxHealthOptions = {}): readonly string[] {
  const healed: string[] = [];
  const mailboxesDir = resolveMailboxRoot(options);
  const activeSet = resolveActiveAgentSet(options);
  const allDirs = listAgentDirs(mailboxesDir);
  const targetDirs = activeSet !== null ? allDirs.filter((id) => activeSet.has(id)) : allDirs;
  for (const agentId of targetDirs) {
    const agentDir = join(mailboxesDir, agentId);
    const { isCorrupt } = inspectCursor(join(agentDir, "cursor.json"));
    if (
      isCorrupt &&
      healCorruptedCursor(join(agentDir, "cursor.json"), join(agentDir, "inbox.jsonl"))
    ) {
      healed.push(`Rebuilt corrupted cursor for mailbox '${agentId}'`);
    }
  }
  healed.push(...pruneOrphanedMailboxes(options));
  return healed;
}
