import type { JsonObject } from "./json.ts";

export interface InstallationManifest extends JsonObject {
  schema: "harness.installation";
  version: number;
  source_sha256: string;
  installed_at: string;
  clients: string[];
}

export interface InstallationStatus extends JsonObject {
  installed: boolean;
  drifted: boolean;
  links: JsonObject;
  issues: string[];
}
