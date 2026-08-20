/**
 * Values short enough to collide with unrelated text carry no signal, so the sweep ignores them.
 * Ids, timestamps, digests, paths and sentences are all longer than this.
 */
const MIN_DISTINCTIVE_LENGTH = 4;

/**
 * The two keys whose contents are deliberately absent from `graph.json`, each with the reason it is
 * absent. Nothing else may be added here without one: a key on this list is a fact the export does
 * not carry, and the whole point of the sweep is that such a decision has to be made out loud.
 */
export const WITHHELD_KEYS: ReadonlyMap<string, string> = new Map([
  [
    "environment",
    "the child environment carries the live ownership token the runner mints per attempt, and a credential in a file meant for a browser has left the capsule",
  ],
  [
    "projection",
    "every event embeds a full state snapshot; the final state is exported once in full, so the snapshots are the same facts repeated per event, environments included",
  ],
]);

export interface RecordedFact {
  value: string;
  paths: string[];
}

function collect(value: unknown, path: string, out: Map<string, string[]>): void {
  if (typeof value === "string") {
    if (value.length < MIN_DISTINCTIVE_LENGTH) return;
    const paths = out.get(value) ?? [];
    paths.push(path);
    out.set(value, paths);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collect(entry, `${path}[${index}]`, out));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (WITHHELD_KEYS.has(key)) continue;
      collect(entry, `${path}.${key}`, out);
    }
  }
}

/**
 * Every distinctive string the capsule recorded, with the state paths it sits at. Strings are the
 * carrier here because they are what a fact reads as: an id, a timestamp, a digest, a reason, a
 * summary. A number would match something in any large document and prove nothing.
 */
export function collectRecordedFacts(root: unknown, label: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  collect(root, label, out);
  return out;
}

/**
 * Recorded facts that do not appear anywhere in the exported graph. This is the drift alarm: record
 * something new without exporting it and it lands here, which fails the contract test.
 */
export function unexportedFacts(
  recorded: ReadonlyMap<string, string[]>,
  exported: string,
): RecordedFact[] {
  const missing: RecordedFact[] = [];
  for (const [value, paths] of recorded) {
    if (!exported.includes(value)) missing.push({ value, paths });
  }
  return missing;
}

/** A readable failure: the first few losses with where they were recorded. */
export function describeMissing(missing: readonly RecordedFact[]): string {
  return missing
    .slice(0, 12)
    .map((fact) => `${fact.paths[0]} => ${JSON.stringify(fact.value).slice(0, 120)}`)
    .join("\n");
}
