import { createHash } from "node:crypto";
import { join } from "node:path";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { HarnessError } from "../core/errors/index.ts";
import { loadRun } from "../engine/store/index.ts";
import type { CanonicalCommonInstructions } from "./types.ts";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyCommonInstructions(value: CanonicalCommonInstructions): {
  canonical: CanonicalCommonInstructions;
  text: string;
} {
  const bytes = Uint8Array.from(value.bytes);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HarnessError("INTEGRITY", "common instructions are not valid UTF-8");
  }
  if (text.trim() === "") {
    throw new HarnessError("INTEGRITY", "common instructions must not be empty");
  }
  const actual = digest(bytes);
  if (actual !== value.sha256) {
    throw new HarnessError("INTEGRITY", "common instruction digest does not match its bytes");
  }
  return { canonical: { bytes, sha256: actual }, text };
}

import { resolveCommonInstructionsAsset } from "./asset-paths.ts";

export async function loadCommonInstructions(
  runRoot: string,
): Promise<CanonicalCommonInstructions> {
  const loaded = loadRun(runRoot);
  const bytes = readRegularFileNoFollow(resolveCommonInstructionsAsset());
  loadRun(loaded.runRoot);
  return verifyCommonInstructions({ bytes, sha256: digest(bytes) }).canonical;
}
