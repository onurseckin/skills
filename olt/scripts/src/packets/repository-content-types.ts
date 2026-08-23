import type { JsonObject } from "../core/contracts/json.ts";

export interface RepositoryIndexEntry extends JsonObject {
  mode: string;
  oid: string;
  stage: number;
}

export interface RepositoryContentPath {
  path: string;
  index: RepositoryIndexEntry[];
}
