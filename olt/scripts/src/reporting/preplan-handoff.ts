import type { RunFiles } from "../core/contracts/capsule.ts";
import { registryArgv } from "./registry-argv.ts";

const PREPLAN_NEXT_COMMANDS: readonly string[] = [
  "plan:status",
  "doctor",
  "plan:add",
  "plan:compile",
];

export function renderPreplanHandoff(loaded: RunFiles, entrypoint: string): string {
  const run = loaded.runRoot;
  const packets = loaded.state.packets ?? {};
  const recent = loaded.events
    .slice(-10)
    .map((event) => `${event.sequence} | ${event.timestamp} | ${event.actor} | ${event.kind}`);
  const commands = PREPLAN_NEXT_COMMANDS.map((name) =>
    registryArgv(entrypoint, name, [["run", run]]),
  ).filter((command): command is string[] => command !== undefined);
  return [
    "# Harness handoff",
    "",
    `Run: ${loaded.manifest.run_id}`,
    `Assurance: ${loaded.manifest.assurance}`,
    `Prompt SHA-256: ${loaded.manifest.prompt_sha256}`,
    `State revision: ${loaded.state.revision}`,
    "Graph revision: not-applied",
    "Live wave: none, the plan is not compiled yet",
    "",
    "## Planning state",
    "",
    JSON.stringify({
      baseline_repository_inspection_sha256:
        loaded.state.baseline_repository_inspection_sha256 ?? null,
      current_repository_inspection_sha256:
        loaded.state.current_repository_inspection_sha256 ?? null,
      packets,
    }),
    "",
    "## Completion blockers",
    "",
    "plan is not applied",
    "",
    "## Recent events",
    "",
    ...(recent.length ? recent : ["none"]),
    "",
    "## Exact next argv",
    "",
    ...commands.map((command) => JSON.stringify(command)),
    "",
  ].join("\n");
}
