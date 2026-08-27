export type LayoutRole = "anchor" | "primary" | "derived" | "view" | "export" | "runtime";

export interface LayoutEntry {
  readonly name: string;
  readonly role: LayoutRole;
  readonly responsibility: string;
  readonly createdAtInit: boolean;
}

export const CAPSULE_LAYOUT: readonly LayoutEntry[] = [
  {
    name: "README.md",
    role: "derived",
    responsibility: "What every entry in this capsule is for.",
    createdAtInit: true,
  },
  {
    name: "prompt.md",
    role: "primary",
    responsibility: "The prompt as it was given, byte for byte, never rewritten.",
    createdAtInit: true,
  },
  {
    name: "manifest.json",
    role: "anchor",
    responsibility: "Who this capsule is: run identity, capture assurance and the prompt digest.",
    createdAtInit: true,
  },
  {
    name: "events.jsonl",
    role: "primary",
    responsibility: "Everything that happened, in order, as an append-only hash chain.",
    createdAtInit: true,
  },
  {
    name: "state.json",
    role: "derived",
    responsibility: "Where the run stands now, replayed from the chain.",
    createdAtInit: true,
  },
  {
    name: "index.json",
    role: "derived",
    responsibility: "The catalogue of what exists and where, so a routine question costs one read.",
    createdAtInit: true,
  },
  {
    name: "trace.md",
    role: "derived",
    responsibility: "The run read top to bottom as a numbered sequence of steps.",
    createdAtInit: true,
  },
  {
    name: "handoff.md",
    role: "derived",
    responsibility: "What the next agent needs in order to pick the run up.",
    createdAtInit: false,
  },
  {
    name: "captures.json",
    role: "primary",
    responsibility: "Every captured blob and the command or task that produced it.",
    createdAtInit: false,
  },
  {
    name: "brainstorming.json",
    role: "derived",
    responsibility:
      "Materialized view of the canonical planning.brainstorming state recorded by plan:brainstorm.",
    createdAtInit: false,
  },
  {
    name: "planning/",
    role: "primary",
    responsibility: "The plan documents the run was given, frozen when they were accepted.",
    createdAtInit: true,
  },
  {
    name: "packets/",
    role: "primary",
    responsibility: "The role contract each agent was handed, frozen when it was handed over.",
    createdAtInit: false,
  },
  {
    name: "commands/",
    role: "primary",
    responsibility: "One directory per executed command: what ran, and what it produced.",
    createdAtInit: true,
  },
  {
    name: "blobs/",
    role: "primary",
    responsibility: "Every captured byte-blob, stored once under its own SHA-256.",
    createdAtInit: true,
  },
  {
    name: "evidence/",
    role: "view",
    responsibility: "Readable names for the blobs, linked so the bytes are still stored only once.",
    createdAtInit: true,
  },
  {
    name: "reports/",
    role: "primary",
    responsibility: "One immutable document per validation act, kept as it was asserted.",
    createdAtInit: true,
  },
  {
    name: "screenshots/",
    role: "primary",
    responsibility: "Captured visual reports and screenshot artifacts.",
    createdAtInit: false,
  },
  {
    name: "summary/",
    role: "export",
    responsibility: "The export handed to the visualizer: the one place repetition is deliberate.",
    createdAtInit: false,
  },
  {
    name: "quarantine/",
    role: "primary",
    responsibility:
      "Event-log fragments recovery removed, kept byte for byte as forensic evidence.",
    createdAtInit: false,
  },
  {
    name: "runtime/",
    role: "runtime",
    responsibility: "The pinned copy of the harness code that is executing this run.",
    createdAtInit: false,
  },
  {
    name: "last_pulse.json",
    role: "runtime",
    responsibility: "The latest pulse execution status and next wake timestamp.",
    createdAtInit: false,
  },
];

export const LOCKS_DIRECTORY = ".locks";

const DECLARED = new Set(CAPSULE_LAYOUT.map((entry) => entry.name.replace(/\/$/u, "")));

export function isDeclaredCapsuleEntry(name: string): boolean {
  return DECLARED.has(name);
}

export function initialCapsuleDirectories(): string[] {
  return CAPSULE_LAYOUT.filter((entry) => entry.createdAtInit && entry.name.endsWith("/")).map(
    (entry) => entry.name.slice(0, -1),
  );
}

const ROLE_LABEL: Record<LayoutRole, string> = {
  anchor: "ANCHOR",
  primary: "PRIMARY",
  derived: "DERIVED",
  view: "VIEW",
  export: "EXPORT",
  runtime: "RUNTIME",
};

const ROLE_MEANING: readonly string[] = [
  "- **PRIMARY** — the only copy. Losing it loses the fact.",
  "- **ANCHOR** — the identity this capsule is bound to.",
  "- **DERIVED** — rebuilt from PRIMARY entries. Safe to delete.",
  "- **VIEW** — readable names for bytes that live in `blobs/`. Holds no bytes of its own.",
  "- **EXPORT** — handed to another program, and deliberately self-contained.",
  "- **RUNTIME** — a pinned, verified copy of the code executing this run, not a fact about it.",
];

export function renderLayoutReadme(runId: string): string {
  const width = Math.max(...CAPSULE_LAYOUT.map((entry) => entry.name.length));
  const rows = CAPSULE_LAYOUT.map(
    (entry) =>
      `${entry.name.padEnd(width)}  ${ROLE_LABEL[entry.role].padEnd(7)}  ${entry.responsibility}`,
  );
  return [
    `# Capsule \`${runId}\``,
    "",
    "Everything this run recorded. Read `trace.md` for the sequence of steps, `index.json` to find",
    "a specific record, and `events.jsonl` when you need the authority behind either.",
    "",
    "```",
    ...rows,
    "```",
    "",
    ...ROLE_MEANING,
    "",
    "Every byte-blob — screenshots, captured reports — is stored exactly once under `blobs/`, named",
    "by its SHA-256. `evidence/` gives those blobs readable names by linking to them, so a file that",
    "appears in both places is one file on disk, not two copies.",
    "",
    "Run locks are not stored here. They live beside the capsules in `.capsules/.locks/`, because",
    "coordination state is not durable state.",
    "",
  ].join("\n");
}
