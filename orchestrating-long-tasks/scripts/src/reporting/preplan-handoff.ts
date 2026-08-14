import { join } from "node:path";
import type { RunFiles } from "../contracts/capsule.ts";

function argv(value: string[]): string {
  return JSON.stringify(value);
}

export function renderPreplanHandoff(loaded: RunFiles, entrypoint: string): string {
  const run = loaded.runRoot;
  const requirements = join(run, "planning", "requirements.json");
  const graph = join(run, "planning", "graph.json");
  const packets = loaded.state.packets ?? {};
  const recent = loaded.events
    .slice(-10)
    .map((event) => `${event.sequence} | ${event.timestamp} | ${event.actor} | ${event.kind}`);
  const commands = [
    ["bun", entrypoint, "status", "--run", run],
    ["bun", entrypoint, "doctor", "--run", run],
    [
      "bun",
      entrypoint,
      "packet",
      "--run",
      run,
      "--role",
      "planner",
      "--agent",
      "planner",
      "--id",
      "planner-0",
    ],
    ["bun", entrypoint, "validate", "--run", run, "--requirements", requirements, "--graph", graph],
    [
      "bun",
      entrypoint,
      "plan-apply",
      "--run",
      run,
      "--requirements",
      requirements,
      "--graph",
      graph,
      "--expected-revision",
      "0",
      "--actor",
      "planner",
    ],
  ];
  return [
    "# Harness handoff",
    "",
    `Run: ${loaded.manifest.run_id}`,
    `Assurance: ${loaded.manifest.assurance}`,
    `Prompt SHA-256: ${loaded.manifest.prompt_sha256}`,
    `State revision: ${loaded.state.revision}`,
    "Graph revision: not-applied",
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
    ...commands.map(argv),
    "",
  ].join("\n");
}
