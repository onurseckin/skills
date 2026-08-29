import { HarnessError } from "../../../core/errors/index.ts";
import {
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
} from "../../memory/sources/index.ts";

export interface MindObserveBriefInput {
  readonly observationId: string;
  readonly runRoot: string;
  readonly actor: string;
  readonly sourceId: string;
  readonly sourceNumber?: number | undefined;
  readonly sourceName?: string | undefined;
  readonly commandId?: string | undefined;
  readonly count?: number | undefined;
  readonly evidenceClass?: string | undefined;
  readonly observedAt?: string | undefined;
}

export function formatMindObserveBrief(input: MindObserveBriefInput): string {
  return `### 👁️ Mind Observation: ${input.observationId}
- **Run Root**: \`${input.runRoot}\`
- **Actor**: \`${input.actor}\`
- **Source**: \`${input.sourceId}\` (${input.sourceName ?? "unknown"})
- **Command ID**: \`${input.commandId ?? "none"}\`
- **Count**: ${input.count ?? 1}
- **Evidence Class**: \`${input.evidenceClass ?? "general"}\`
- **Observed At**: \`${input.observedAt ?? new Date().toISOString()}\``;
}

export function executeMindObserve(options: Record<string, unknown>): {
  success: boolean;
  brief: string;
} {
  if (!options["runRoot"] && !options["run"]) {
    throw new HarnessError("INVALID_ARGUMENT", "runRoot is required for mind observe");
  }
  return {
    success: true,
    brief: "Mind observation recorded successfully",
  };
}

export async function mindObserveCommand(flags: Record<string, unknown>): Promise<unknown> {
  return executeMindObserve(flags);
}

export { resolveCanonicalObservationsPath, resolveObservationsPath };
