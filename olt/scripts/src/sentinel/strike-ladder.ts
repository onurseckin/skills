import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AgentRole, SentinelViolation, StrikeRecord } from "./types.ts";

const inMemoryStrikes = new Map<string, StrikeRecord>();
let inMemoryStrikeMode = false;

export function setInMemoryStrikeMode(enabled: boolean): void {
  inMemoryStrikeMode = enabled;
}

export function clearInMemoryStrikes(): void {
  inMemoryStrikes.clear();
}

function resolveStrikePath(agentId: string, repoRoot?: string): string {
  const root = repoRoot ? resolve(repoRoot) : process.cwd();
  return join(root, ".olt", "sentinel", "strikes", `${agentId}.json`);
}

export function getStrikeRecord(agentId: string, repoRoot?: string): StrikeRecord | null {
  if (inMemoryStrikeMode) {
    return inMemoryStrikes.get(agentId) ?? null;
  }

  const filePath = resolveStrikePath(agentId, repoRoot);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as StrikeRecord;
    return parsed;
  } catch {
    return null;
  }
}

export function recordStrike(
  agentId: string,
  role: AgentRole,
  violations: readonly SentinelViolation[],
  taskId?: string,
  repoRoot?: string,
): StrikeRecord {
  const current = getStrikeRecord(agentId, repoRoot);
  const nextCount = violations.length === 0 ? 0 : (current?.strike_count ?? 0) + 1;
  const frozen = nextCount >= 3;

  const record: StrikeRecord = {
    agent_id: agentId,
    role,
    task_id: taskId ?? current?.task_id,
    strike_count: nextCount,
    active_violations: violations,
    updated_at: new Date().toISOString(),
    frozen,
  };

  if (inMemoryStrikeMode) {
    inMemoryStrikes.set(agentId, record);
    return record;
  }

  const filePath = resolveStrikePath(agentId, repoRoot);
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
  } catch {}

  return record;
}

export function resetStrikes(agentId: string, repoRoot?: string): void {
  if (inMemoryStrikeMode) {
    inMemoryStrikes.delete(agentId);
    return;
  }

  const filePath = resolveStrikePath(agentId, repoRoot);
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
    } catch {}
  }
}

export function determineStrikeAction(
  strikeCount: number,
): "NONE" | "ADVISE" | "BLOCK" | "ESCALATE" {
  if (strikeCount <= 0) return "NONE";
  if (strikeCount === 1) return "ADVISE";
  if (strikeCount === 2) return "BLOCK";
  return "ESCALATE";
}

export function renderMarkdownRemediationBrief(
  agentId: string,
  role: AgentRole,
  strike: number,
  violations: readonly SentinelViolation[],
): string {
  const action = determineStrikeAction(strike);
  const title = `### 🚨 [SENTINEL_${action} : STRIKE ${strike}/3] Role Invariant Breach`;
  const agentInfo = `- **Target Agent:** \`${agentId}\` (Role: \`${role}\`)\n- **Status:** ${action === "ESCALATE" ? "**CRITICAL (FROZEN)**" : action === "BLOCK" ? "**MECHANICAL INTERLOCK (BLOCK)**" : "**ADVISORY**"}`;

  const violationList = violations
    .map((v, index) => {
      const file = v.target_file ? `\n  - **Target File:** \`${v.target_file}\`` : "";
      const cmd = v.remediation_cmd
        ? `\n  - **Required Remediation:**\n    \`\`\`bash\n    ${v.remediation_cmd}\n    \`\`\``
        : "";
      const doc = v.documentation_ref ? `\n  - **Contract Reference:** ${v.documentation_ref}` : "";
      return `${index + 1}. **[${v.code}]** (${v.severity})\n  ${v.message}${file}${cmd}${doc}`;
    })
    .join("\n\n");

  const instructions =
    action === "ESCALATE"
      ? "> ⚠️ **TASK LEASE FROZEN**: Strike 3 escalation triggered. Task lease has been frozen (`task:freeze`). This incident has been routed to your parent supervisor."
      : action === "BLOCK"
        ? "> 🛑 **TOOL LOCK ENGAGED**: Non-remedial actions are blocked. You must execute the required remediation command immediately before proceeding."
        : "> 💡 **IN-TURN COURSE CORRECTION**: Execute the remediation command above directly within your active turn to prevent escalation.";

  return `${title}\n\n${agentInfo}\n\n${violationList}\n\n${instructions}`;
}
