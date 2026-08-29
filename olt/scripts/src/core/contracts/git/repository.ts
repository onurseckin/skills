import type { JsonObject } from "../json.ts";

export interface RepositoryContentIdentity extends JsonObject {
  content_sha256: string;
  file_count: number;
  total_bytes: number;
}

export interface RepositoryBinding extends RepositoryContentIdentity {
  schema: "harness.repository-binding";
  version: 1;
  inspection_sha256: string;
  git_identity_sha256: string;
}
