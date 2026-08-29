import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { HarnessEvent } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { isHarnessEvent, type CapsuleEventsResult, type EventStreamOptions } from "./types.ts";

export function resolveCapsulePath(runInput: string, repoRoot: string = process.cwd()): string {
  if (isAbsolute(runInput)) {
    if (existsSync(runInput)) {
      const st = lstatSync(runInput);
      if (st.isFile() && basename(runInput) === "events.jsonl") {
        return dirname(realpathSync(runInput));
      }
      return realpathSync(runInput);
    }
  }

  const direct = resolve(repoRoot, runInput);
  if (existsSync(direct)) {
    const st = lstatSync(direct);
    if (st.isFile() && basename(direct) === "events.jsonl") {
      return dirname(realpathSync(direct));
    }
    return realpathSync(direct);
  }

  const inCapsules = resolve(repoRoot, ".capsules", runInput);
  if (existsSync(inCapsules)) {
    const st = lstatSync(inCapsules);
    if (st.isFile() && basename(inCapsules) === "events.jsonl") {
      return dirname(realpathSync(inCapsules));
    }
    return realpathSync(inCapsules);
  }

  throw new HarnessError("INVALID_ARGUMENT", `capsule run directory not found: ${runInput}`);
}

export function readCapsuleEvents(
  runPath: string,
  options: EventStreamOptions = {},
): CapsuleEventsResult {
  const resolvedRoot = resolveCapsulePath(runPath);
  const eventsFile = join(resolvedRoot, "events.jsonl");

  if (!existsSync(eventsFile)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `events.jsonl not found in capsule directory: ${resolvedRoot}`,
    );
  }

  let manifestRunId = basename(resolvedRoot);
  let manifestCapsuleId: string | undefined;
  const manifestFile = join(resolvedRoot, "manifest.json");
  if (existsSync(manifestFile)) {
    try {
      const manifestRaw = JSON.parse(readFileSync(manifestFile, "utf8")) as unknown;
      if (typeof manifestRaw === "object" && manifestRaw !== null) {
        const manifestObj = manifestRaw as Record<string, unknown>;
        if (typeof manifestObj.run_id === "string") {
          manifestRunId = manifestObj.run_id;
        }
        if (typeof manifestObj.capsule_id === "string") {
          manifestCapsuleId = manifestObj.capsule_id;
        }
      }
    } catch {
    }
  }

  const fileContent = readFileSync(eventsFile, "utf8");
  const rawLines = fileContent.split("\n");
  const allEvents: HarnessEvent[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]?.trim();
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isHarnessEvent(parsed)) {
        allEvents.push(parsed);
      } else if (typeof parsed === "object" && parsed !== null) {
        const eventCandidate = parsed as unknown as HarnessEvent;
        if (
          typeof eventCandidate.sequence === "number" &&
          typeof eventCandidate.kind === "string"
        ) {
          allEvents.push(eventCandidate);
        }
      }
    } catch (err) {
      throw new HarnessError(
        "INTEGRITY",
        `failed to parse event at line ${i + 1} in ${eventsFile}: ${String(err)}`,
      );
    }
  }

  const totalAvailable = allEvents.length;
  let latestSeq = 0;
  for (const ev of allEvents) {
    if (ev.sequence > latestSeq) {
      latestSeq = ev.sequence;
    }
  }

  const typeFilters = options.filterType
    ? (Array.isArray(options.filterType) ? options.filterType : [options.filterType])
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    : [];

  const actorFilters = options.filterActor
    ? (Array.isArray(options.filterActor) ? options.filterActor : [options.filterActor])
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean)
    : [];

  let filtered = allEvents.filter((ev) => {
    if (options.fromSeq !== undefined && ev.sequence < options.fromSeq) {
      return false;
    }
    if (options.toSeq !== undefined && ev.sequence > options.toSeq) {
      return false;
    }
    if (typeFilters.length > 0 && !typeFilters.includes(ev.kind.toLowerCase())) {
      return false;
    }
    if (actorFilters.length > 0 && !actorFilters.includes(ev.actor.toLowerCase())) {
      return false;
    }
    return true;
  });

  let hasMore = false;
  if (!options.all && options.maxEvents !== undefined && options.maxEvents > 0) {
    if (filtered.length > options.maxEvents) {
      hasMore = true;
      filtered = filtered.slice(0, options.maxEvents);
    }
  }

  return {
    runRoot: resolvedRoot,
    runId: manifestRunId,
    ...(manifestCapsuleId !== undefined ? { capsuleId: manifestCapsuleId } : {}),
    totalAvailable,
    matchingEvents: filtered,
    ...(options.fromSeq !== undefined ? { fromSeq: options.fromSeq } : {}),
    ...(options.toSeq !== undefined ? { toSeq: options.toSeq } : {}),
    latestSeq,
    hasMore,
  };
}
