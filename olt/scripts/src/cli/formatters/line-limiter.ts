export interface TableFormatOptions {
  readonly maxColumnWidth?: number | undefined;
  readonly truncate?: boolean | undefined;
}

export function enforceLineLimit(markdown: string, maxLines = 30): string {
  const lines = markdown.trimEnd().split("\n");
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }

  const fenceAtLine: (string | null)[] = Array.from({ length: lines.length });
  let currentFence: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line.startsWith("```")) {
      currentFence = currentFence === "```" ? null : currentFence === null ? "```" : currentFence;
    } else if (line.startsWith("~~~")) {
      currentFence = currentFence === "~~~" ? null : currentFence === null ? "~~~" : currentFence;
    }
    fenceAtLine[i] = currentFence;
  }

  let keepCount = maxLines - 2;
  if (keepCount > 0 && fenceAtLine[keepCount - 1] !== null) {
    keepCount = maxLines - 3;
  }

  if (keepCount < 1) {
    keepCount = Math.max(1, maxLines - 3);
  }

  const activeFence = keepCount > 0 ? fenceAtLine[keepCount - 1] : null;
  const truncated = lines.slice(0, keepCount);
  const remainingCount = lines.length - keepCount;

  if (activeFence) {
    truncated.push(activeFence);
  }
  truncated.push("");
  truncated.push(
    `*... [truncated ${remainingCount} additional lines; use --all or query specific task for full details]*`,
  );

  return truncated.slice(0, maxLines).join("\n");
}

export function formatTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  options?: TableFormatOptions,
): string[] {
  const sanitize = (cell: string | null | undefined): string => {
    const raw = typeof cell === "string" ? cell : String(cell ?? "");
    let text = raw.replace(/\r?\n/g, " ").replace(/(?<!\\)\|/g, "\\|");
    if (
      options?.maxColumnWidth &&
      options.maxColumnWidth > 0 &&
      text.length > options.maxColumnWidth
    ) {
      text = options.truncate
        ? `${text.slice(0, Math.max(0, options.maxColumnWidth - 3))}...`
        : text;
    }
    return text;
  };

  const cleanHeaders = headers.map(sanitize);
  const cleanRows = rows.map((row) => row.map(sanitize));
  const headerLine = `| ${cleanHeaders.join(" | ")} |`;
  const separatorLine = `| ${cleanHeaders.map(() => ":---").join(" | ")} |`;
  const rowLines = cleanRows.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, separatorLine, ...rowLines];
}
