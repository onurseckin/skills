import type { ProseMilestoneClaim } from "./types.ts";
import {
  IGNITION_REGEX,
  INVARIANT_REGEX,
  EXECUTION_REGEX,
  COMPLETION_REGEX,
  TEST_PASS_REGEX,
} from "./regex.ts";

export function extractProseMilestoneClaims(
  markdownContent: string,
  sourcePath?: string,
): readonly ProseMilestoneClaim[] {
  const claims: ProseMilestoneClaim[] = [];
  const lines = markdownContent.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line || line.startsWith("```") || line.length === 0) continue;

    if (IGNITION_REGEX.test(line)) {
      claims.push({
        type: "ignition",
        rawText: line,
        sourcePath,
        line: index + 1,
      });
    }

    if (INVARIANT_REGEX.test(line)) {
      claims.push({
        type: "invariant",
        rawText: line,
        sourcePath,
        line: index + 1,
      });
    }

    const execMatch = line.match(EXECUTION_REGEX);
    if (execMatch) {
      let count: number | undefined;
      if (execMatch[2]) count = parseInt(execMatch[2], 10);
      else if (execMatch[3]) count = parseInt(execMatch[3], 10);
      else count = 1;

      claims.push({
        type: "execution",
        rawText: line,
        claimedCommandsCount: count,
        sourcePath,
        line: index + 1,
      });
    }

    if (TEST_PASS_REGEX.test(line)) {
      claims.push({
        type: "test_pass",
        rawText: line,
        sourcePath,
        line: index + 1,
      });
    }

    if (COMPLETION_REGEX.test(line)) {
      claims.push({
        type: "completion",
        rawText: line,
        sourcePath,
        line: index + 1,
      });
    }
  }

  return claims;
}
