import { resolve } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";
import { actorFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { expandReadScope } from "../../runtime/read-scope-guard.ts";
import { emitTelemetryEvent } from "../../reporting/telemetry-stream.ts";
import { findRepoRoot } from "../../shared/paths.ts";

export interface ScopeExpandResult {
  readonly markdown: string;
  readonly actor: string;
  readonly expanded_path: string;
  readonly allowed_read_scope: readonly string[];
  readonly [key: string]: unknown;
}

export function scopeExpandCommand(flags: Flags, _context: CommandContext = {}): ScopeExpandResult {
  const actor = actorFlag(flags);
  const readPath = textFlag(flags, "read", true)!.trim();
  const run = textFlag(flags, "run", false) ?? textFlag(flags, "run-id", false);

  if (!readPath) {
    throw new HarnessError("INVALID_ARGUMENT", "--read path cannot be empty");
  }

  const runRoot = run ? resolve(run) : undefined;
  const result = expandReadScope(actor, readPath, runRoot);

  const repoRoot = findRepoRoot(runRoot);
  emitTelemetryEvent(
    {
      timestamp: new Date().toISOString(),
      actor,
      action: `scope:expand: ${readPath}`,
      status: "success",
      details: { expanded_path: readPath, total_allowed_scopes: result.allowed_read_scope.length },
    },
    repoRoot,
  );

  const lines: string[] = [
    `### Read Scope Expanded for Actor: \`${actor}\``,
    `- **Granted Path**: \`${readPath}\``,
    `- **Active Read Scopes**: ${result.allowed_read_scope.map((s) => `\`${s}\``).join(", ")}`,
  ];

  return {
    markdown: lines.join("\n"),
    actor,
    expanded_path: readPath,
    allowed_read_scope: result.allowed_read_scope,
  };
}
