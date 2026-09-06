export interface CommandAliasEntry {
  readonly alias: string;
  readonly canonicalCommand: string;
  readonly domain: string;
  readonly description: string;
  readonly isSynthetic: boolean;
}

export interface CommandAliasesLayout {
  readonly version: string;
  readonly aliases: readonly CommandAliasEntry[];
  readonly totalCount: number;
  readonly syntheticCount: number;
  readonly layoutValid: boolean;
}

export interface DoctorSyntheticCommandAliasesDefectResult {
  readonly defectId: string;
  readonly defectRemediated: boolean;
  readonly layout: CommandAliasesLayout;
  readonly issues: readonly string[];
}

export function validateDoctorSyntheticCommandAliasesLayout(
  aliases: readonly CommandAliasEntry[],
): { readonly valid: boolean; readonly issues: readonly string[] } {
  const issues: string[] = [];
  const aliasSet = new Set<string>();

  for (const entry of aliases) {
    if (!entry.alias || entry.alias.trim().length === 0) {
      issues.push("Empty alias encountered");
    }
    if (aliasSet.has(entry.alias)) {
      issues.push(`Duplicate alias detected: ${entry.alias}`);
    }
    aliasSet.add(entry.alias);

    if (!entry.canonicalCommand || entry.canonicalCommand.trim().length === 0) {
      issues.push(`Missing canonical command for alias: ${entry.alias}`);
    }
    if (entry.isSynthetic && !entry.canonicalCommand.includes(":")) {
      issues.push(
        `Synthetic alias ${entry.alias} targets non-namespaced command: ${entry.canonicalCommand}`,
      );
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function buildDefaultSyntheticCommandAliases(): readonly CommandAliasEntry[] {
  return [
    {
      alias: "run:check",
      canonicalCommand: "run:exec",
      domain: "run",
      description: "Execute a command within capsule runtime",
      isSynthetic: true,
    },
    {
      alias: "status",
      canonicalCommand: "run:status",
      domain: "run",
      description: "Check status of capsule execution",
      isSynthetic: true,
    },
    {
      alias: "sync",
      canonicalCommand: "queue:wave",
      domain: "queue",
      description: "Synchronize current ready wave",
      isSynthetic: true,
    },
    {
      alias: "report:unified",
      canonicalCommand: "report:usage",
      domain: "report",
      description: "Generate report usage summary",
      isSynthetic: true,
    },
    {
      alias: "report:dag",
      canonicalCommand: "report:get",
      domain: "report",
      description: "Retrieve compiled DAG report",
      isSynthetic: true,
    },
    {
      alias: "task:recover",
      canonicalCommand: "task:release",
      domain: "task",
      description: "Recover or release orphaned task lease",
      isSynthetic: true,
    },
    {
      alias: "task:show",
      canonicalCommand: "task:brief",
      domain: "task",
      description: "Inspect task briefing details",
      isSynthetic: true,
    },
    {
      alias: "command:list",
      canonicalCommand: "agent:list",
      domain: "agent",
      description: "List registered agents and capabilities",
      isSynthetic: true,
    },
    {
      alias: "msg:read",
      canonicalCommand: "msg:recv",
      domain: "msg",
      description: "Read incoming messages from mailbox",
      isSynthetic: true,
    },
    {
      alias: "msg",
      canonicalCommand: "msg:send",
      domain: "msg",
      description: "Send message to target mailbox",
      isSynthetic: true,
    },
  ];
}

export function remediateDoctorSyntheticCommandAliasesLayout(
  customAliases?: readonly CommandAliasEntry[],
): DoctorSyntheticCommandAliasesDefectResult {
  const aliases = customAliases ?? buildDefaultSyntheticCommandAliases();
  const validation = validateDoctorSyntheticCommandAliasesLayout(aliases);
  const syntheticCount = aliases.filter((a) => a.isSynthetic).length;

  const layout: CommandAliasesLayout = {
    version: "1.0.0",
    aliases,
    totalCount: aliases.length,
    syntheticCount,
    layoutValid: validation.valid,
  };

  return {
    defectId: "doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1",
    defectRemediated: validation.valid,
    layout,
    issues: validation.issues,
  };
}
