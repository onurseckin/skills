import type { JsonObject } from "../contracts/json.ts";
import { queryScreenshots } from "./screenshot-store.ts";

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
    screenshot_records: screenshots,
  };
}

export function commandRecordPath(commandId: string): string {
  return `commands/${commandId}/record.json`;
}
