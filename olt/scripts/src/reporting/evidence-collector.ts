export interface CommandEvidence {
  exitCode: number;
  timingMs: number;
  sha256Hash: string;
  rawOutput: string;
}

export function truncateSemanticTrace(
  evidence: CommandEvidence,
  maxLines: number = 50,
): CommandEvidence {
  const lines = evidence.rawOutput.split("\n");
  if (lines.length <= maxLines) {
    return evidence;
  }

  const half = Math.floor(maxLines / 2);
  const head = lines.slice(0, half).join("\n");
  const tail = lines.slice(-half).join("\n");

  const prunedOutput = `${head}\n\n... [TRUNCATED ${lines.length - maxLines} lines for token conservation] ...\n\n${tail}`;

  return {
    ...evidence,
    rawOutput: prunedOutput,
  };
}
