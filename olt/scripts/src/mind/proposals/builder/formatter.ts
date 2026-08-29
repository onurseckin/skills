import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { ExactAnchorBriefing, ExactAnchor } from "./types.ts";
import { resolveFilePath, TEST_GATE_PREFIXES, TEST_FILE_EXTENSIONS } from "./types.ts";

function isTestGateCommand(command: string): boolean {
  for (const prefix of TEST_GATE_PREFIXES) {
    if (command.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function isTestFilePath(filePath: string): boolean {
  for (const ext of TEST_FILE_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

export function deriveRecommendedTestCommands(
  targetFiles: readonly string[],
  gateCommands?: readonly string[],
  baseDir?: string,
): readonly string[] {
  const commands: string[] = [];

  if (gateCommands !== undefined) {
    for (const gate of gateCommands) {
      if (isTestGateCommand(gate)) {
        if (!commands.includes(gate)) {
          commands.push(gate);
        }
      }
    }
  }

  for (const file of targetFiles) {
    if (isTestFilePath(file)) {
      const cmd = `bun test ${file}`;
      if (!commands.includes(cmd)) {
        commands.push(cmd);
      }
      continue;
    }

    const base = basename(file).replace(/\.(ts|js|tsx|jsx)$/, "");
    const candidatePaths = [
      `tests/unit/mind/briefing-builder.test.ts`,
      `tests/unit/mind/${base}.test.ts`,
      `tests/unit/${base}.test.ts`,
      `tests/${base}.test.ts`,
    ];

    for (const candidate of candidatePaths) {
      const full = resolveFilePath(candidate, baseDir);
      if (existsSync(full)) {
        const cmd = `bun test ${candidate}`;
        if (!commands.includes(cmd)) {
          commands.push(cmd);
        }
        break;
      }
    }
  }

  if (!commands.includes("bun run typecheck")) {
    commands.push("bun run typecheck");
  }
  if (!commands.includes("bun run lint")) {
    commands.push("bun run lint");
  }

  return commands;
}

export function formatExactAnchorBriefingMarkdown(
  briefing: Omit<ExactAnchorBriefing, "markdown">,
): string {
  const lines: string[] = [];

  lines.push(`### 🌌 Zero-Exploration Exact-Anchor Briefing: ${briefing.taskId}`);
  lines.push(`- **Task ID**: \`${briefing.taskId}\``);
  lines.push(`- **Label**: ${briefing.label}`);

  const scopeStr =
    briefing.writeScope.length > 0
      ? briefing.writeScope.map((s) => `\`${s}\``).join(", ")
      : "`none`";
  lines.push(`- **Assigned Write Scope**: ${scopeStr}`);
  lines.push(
    `  > ⚠️ **Scope Invariant**: You are STRICTLY confined to modifying files in your assigned write scope. Modifying any other file is a critical integrity violation.`,
  );

  if (briefing.targetFiles.length > 0) {
    const targetsStr = briefing.targetFiles.map((f) => `\`${f}\``).join(", ");
    lines.push(`- **Target Files**: ${targetsStr}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("#### 📌 Exact Code Anchors & Replacement Targets");

  if (briefing.anchors.length === 0) {
    lines.push(
      "- No existing file anchors extracted. Target files may be newly created within your assigned write scope.",
    );
  } else {
    const groupedByFile = new Map<string, ExactAnchor[]>();
    for (const anchor of briefing.anchors) {
      const existing = groupedByFile.get(anchor.filePath);
      if (existing !== undefined) {
        existing.push(anchor);
      } else {
        groupedByFile.set(anchor.filePath, [anchor]);
      }
    }

    const entries = Array.from(groupedByFile.entries());
    for (const [filePath, fileAnchors] of entries) {
      lines.push(`##### File: \`${filePath}\``);
      for (const anchor of fileAnchors) {
        const desc =
          anchor.description !== undefined
            ? anchor.description
            : `Lines ${anchor.startLine}–${anchor.endLine}`;
        lines.push(`- **Anchor**: ${desc}`);
        lines.push("```typescript");
        lines.push(anchor.contextSnippet);
        lines.push("```");
      }
    }
  }

  if (briefing.symbols.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("#### 🗺️ Symbol Map");
    lines.push("| Symbol | Kind | Lines | Exported | Signature |");
    lines.push("| :--- | :--- | :--- | :--- | :--- |");
    for (const sym of briefing.symbols) {
      const expStr = sym.exported === true ? "Yes" : "No";
      const normalizedSig =
        sym.signature !== undefined ? sym.signature.replace(/\s+/g, " ").trim() : undefined;
      const sigStr = normalizedSig !== undefined ? `\`${normalizedSig}\`` : "-";
      lines.push(
        `| \`${sym.name}\` | \`${sym.kind}\` | ${sym.startLine}–${sym.endLine} | ${expStr} | ${sigStr} |`,
      );
    }
  }

  if (briefing.recommendedCommands.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("#### 🧪 Recommended Verification Commands");
    for (const cmd of briefing.recommendedCommands) {
      lines.push(`- \`${cmd}\``);
    }
  }

  if (briefing.gateCommands.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("#### 🚪 Gate Commands");
    for (const cmd of briefing.gateCommands) {
      lines.push(`- \`${cmd}\``);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("#### ✅ Acceptance Criteria");
  for (const ac of briefing.acceptanceCriteria) {
    lines.push(`- ${ac}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("#### ⚡ Mandatory Execution Directives");
  lines.push(
    `1. **WaitMsBeforeAsync Mandate**: Always specify \`WaitMsBeforeAsync: ${briefing.waitMsMandate}\` on all \`run_command\` invocations for deterministic synchronous execution.`,
  );
  lines.push(
    `2. **Disjoint Write Scope Invariant**: Confine 100% of code modifications strictly to assigned write scope (${scopeStr}).`,
  );
  lines.push(
    `3. **Zero 'any' / Zero Suppressions**: 0 \`any\` annotations, 0 \`${"@"}ts-ignore\`, 0 \`${"@"}ts-expect-error\`, 0 \`eslint-disable\`.`,
  );
  lines.push(
    `4. **Task Submission**: Submit completed task via \`bun ./olt/scripts/harness.ts task:submit --run <run> --task ${briefing.taskId} --agent <agent> --token <token> --summary "<summary>"\`.`,
  );

  return lines.join("\n");
}
