import type { HarnessEvent, IntegrityIssue, RunState } from "../contracts/capsule.ts";
import type { JsonObject } from "../contracts/json.ts";
import { canonicalJsonBytes, parseJsonBytes, sha256Bytes } from "../core/json.ts";
import { EVENT_SCHEMA, FORMAT_VERSION, type StoreLimits, limits } from "./constants.ts";
import { streamEventLines } from "./event-lines.ts";
import { exactInteger, validateProjection } from "./event-validation.ts";
import { issue } from "./issues.ts";
import { initialState } from "./state.ts";

export interface ChainResult {
  events: readonly HarnessEvent[];
  finalState: RunState;
  issues: readonly IntegrityIssue[];
  eventCount: number;
  completeBytes: number;
  tornTail?: Uint8Array;
}

export function validateEventChain(
  path: string,
  identity: { runId: string; capsuleId: string },
  options: StoreLimits = {},
  reportTorn = true,
  collectEvents = true,
): ChainResult {
  const configured = limits(options);
  const found: IntegrityIssue[] = [];
  const events: HarnessEvent[] = [];
  let expected = 1;
  let previous: string | null = null;
  let finalState = initialState();
  let eventCount = 0;
  let completeBytes = 0;
  let tornTail: Uint8Array | undefined;
  try {
    for (const line of streamEventLines(
      path,
      configured.maxEventBytes,
      configured.maxEventLogBytes,
    )) {
      if (line.index > configured.maxEventCount) {
        found.push(
          issue(
            "EVENT_COUNT",
            `event count exceeds the ${configured.maxEventCount}-event limit`,
            path,
          ),
        );
        break;
      }
      if (line.oversized)
        found.push(
          issue(
            "EVENT_SIZE",
            `event line ${line.index} exceeds the ${configured.maxEventBytes}-byte size limit`,
            path,
          ),
        );
      if (!line.terminated) {
        tornTail = line.content;
        if (reportTorn)
          found.push(
            issue(
              "EVENT_TORN",
              `events.jsonl has a torn final fragment at line ${line.index}`,
              path,
            ),
          );
        break;
      }
      completeBytes = line.endOffset;
      if (line.oversized) continue;
      const before = found.length;
      let parsed: unknown;
      try {
        parsed = parseJsonBytes(line.content, `event line ${line.index}`, {
          maxBytes: configured.maxEventBytes,
          maxDepth: configured.maxDepth,
        });
      } catch (error) {
        found.push(
          issue(
            "EVENT_JSON",
            `event line ${line.index} is not a complete JSON object: ${String(error)}`,
            path,
          ),
        );
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        found.push(issue("EVENT_JSON", `event line ${line.index} must be a JSON object`, path));
        continue;
      }
      const event = parsed as unknown as HarnessEvent;
      if (!Buffer.from(line.content).equals(Buffer.from(canonicalJsonBytes(event))))
        found.push(
          issue("EVENT_CANONICAL", `event line ${line.index} is not canonical JSON`, path),
        );
      if (event.schema !== EVENT_SCHEMA || !exactInteger(event.version, FORMAT_VERSION))
        found.push(
          issue("EVENT_SCHEMA", `event line ${line.index} has an invalid schema or version`, path),
        );
      if (event.run_id !== identity.runId)
        found.push(
          issue(
            "EVENT_RUN_ID",
            `event line ${line.index} run_id does not match run ${identity.runId}`,
            path,
          ),
        );
      if (event.capsule_id !== identity.capsuleId)
        found.push(
          issue(
            "EVENT_CAPSULE_ID",
            `event line ${line.index} capsule_id does not match capsule identity`,
            path,
          ),
        );
      if (!exactInteger(event.sequence, expected))
        found.push(issue("EVENT_SEQUENCE", `event line ${line.index} sequence is invalid`, path));
      if (!exactInteger(event.revision, expected))
        found.push(issue("EVENT_REVISION", `event line ${line.index} revision is invalid`, path));
      if (event.previous_hash !== previous)
        found.push(
          issue(
            "EVENT_CHAIN",
            `event line ${line.index} previous hash does not match the chain head`,
            path,
          ),
        );
      if (typeof event.actor !== "string" || !event.actor.trim())
        found.push(issue("EVENT_ACTOR", `event line ${line.index} has a blank actor`, path));
      if (typeof event.kind !== "string" || !event.kind.trim())
        found.push(issue("EVENT_KIND", `event line ${line.index} has a blank kind`, path));
      if (
        typeof event.payload !== "object" ||
        event.payload === null ||
        Array.isArray(event.payload)
      )
        found.push(
          issue("EVENT_PAYLOAD", `event line ${line.index} payload must be an object`, path),
        );
      if (
        typeof event.timestamp !== "string" ||
        !event.timestamp.endsWith("Z") ||
        !Number.isFinite(Date.parse(event.timestamp))
      )
        found.push(issue("EVENT_TIME", `event line ${line.index} timestamp is not UTC`, path));
      found.push(...validateProjection(event.projection, expected, expected, line.index));
      const hash = event.hash;
      if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash))
        found.push(
          issue(
            "EVENT_HASH",
            `event line ${line.index} hash is not a lowercase SHA-256 digest`,
            path,
          ),
        );
      else {
        const { hash: _hash, ...content } = event;
        if (hash !== sha256Bytes(canonicalJsonBytes(content as JsonObject)))
          found.push(
            issue("EVENT_HASH", `event line ${line.index} hash does not match its content`, path),
          );
      }
      if (found.length === before) {
        if (collectEvents) events.push(event);
        eventCount += 1;
        previous = hash;
        expected += 1;
        finalState = { ...structuredClone(event.projection), event_head: hash };
      }
    }
  } catch (error) {
    found.push(issue("EVENT_READ", `events.jsonl is unreadable: ${String(error)}`, path));
  }
  return {
    events,
    finalState,
    issues: found,
    eventCount,
    completeBytes,
    ...(tornTail === undefined ? {} : { tornTail }),
  };
}
