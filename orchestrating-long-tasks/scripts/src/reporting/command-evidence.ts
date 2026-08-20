import type { JsonObject } from "../contracts/json.ts";
import { queryScreenshots } from "./screenshot-store.ts";

/**
 * What a command did, assembled from the two places that own it: the durable command record, and
 * the capture ledger. There is no third document restating either — a separate evidence file could
 * disagree with the record and nothing would say which of them was true.
 *
 * Screenshots are attached by the ids the ingestion recorded, never by name resemblance.
 */
export function commandEvidenceView(
  runRoot: string,
  command: JsonObject,
  commandId: string,
): Record<string, unknown> {
  const screenshots = queryScreenshots(runRoot, { commandId });
  return {
    ...command,
    command_id: commandId,
    path: `commands/${commandId}`,
    screenshots: screenshots.map((record) => record.path),
    screenshot_records: screenshots,
  };
}

/** Where a command's record lives, relative to the capsule. */
export function commandRecordPath(commandId: string): string {
  return `commands/${commandId}/record.json`;
}
