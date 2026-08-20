import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { repositoryGit, type RepositoryGitCommand } from "./repository-git-command.ts";

/** What Git may hand back before the read itself is treated as a failure. */
export const DIFF_READ_CEILING_BYTES = 8 * 1024 * 1024;
/** How much of the diff the packet carries. A longer diff is kept from the top and says so. */
export const DIFF_TEXT_CEILING_BYTES = 256 * 1024;

export interface DiffAnchor extends JsonObject {
  inspection_sha256: string;
  captured_at: string;
  phase: string;
  head_commit: string | null;
}

export interface AnchoredDiff extends JsonObject {
  anchor: DiffAnchor;
  argv?: string[];
  measured_at?: string;
  text?: string;
  truncated?: boolean;
  /** Why there is no diff. Present only when one could not be measured. */
  unavailable?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The commit an inspection recorded, or null when it recorded none. Nothing is inferred from the
 * inspection's digests: a repository whose Git metadata was unavailable has no commit to name.
 */
export function diffAnchor(inspection: JsonObject): DiffAnchor {
  const git = isJsonObject(inspection.git) ? inspection.git : undefined;
  const head = git?.head;
  return {
    inspection_sha256: text(inspection.inspection_sha256),
    captured_at: text(inspection.captured_at),
    phase: text(inspection.phase),
    head_commit: typeof head === "string" && head !== "" ? head : null,
  };
}

/**
 * The working tree read against the commit an earlier inspection recorded. The entry names the argv
 * that produced it and the anchor it is relative to, so a diff taken against a commit that has not
 * moved since the run began is legible as exactly that rather than passing for a smaller delta.
 *
 * Untracked files never reach `git diff`; the inspections the packet already carries record the
 * porcelain status, which is where a file Git has never seen shows up.
 */
export function anchoredDiff(
  repositoryRoot: string,
  anchor: DiffAnchor,
  measuredAt: Date,
  command: RepositoryGitCommand = repositoryGit,
): AnchoredDiff {
  if (anchor.head_commit === null)
    return { anchor, unavailable: "the anchor inspection recorded no commit" };
  const argv = [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    anchor.head_commit,
    "--",
    ".",
    ":(exclude).capsules",
    ":(exclude).capsules/**",
  ];
  try {
    const { bytes } = command(repositoryRoot, argv, DIFF_READ_CEILING_BYTES);
    const truncated = bytes.byteLength > DIFF_TEXT_CEILING_BYTES;
    return {
      anchor,
      argv,
      measured_at: measuredAt.toISOString(),
      text: (truncated ? bytes.subarray(0, DIFF_TEXT_CEILING_BYTES) : bytes).toString("utf8"),
      truncated,
    };
  } catch (error) {
    if (!(error instanceof HarnessError)) throw error;
    return { anchor, argv, unavailable: error.message };
  }
}
