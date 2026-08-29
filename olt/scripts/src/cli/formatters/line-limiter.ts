export interface TableFormatOptions {
  readonly maxColumnWidth?: number | undefined;
  readonly truncate?: boolean | undefined;
}

export function enforceLineLimit(markdown: string, maxLines = 30): string {
  const lines = markdown.trimEnd().split("\n");
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }
  const keepCount = maxLines - 2;
  const truncated = lines.slice(0, keepCount);
  const remainingCount = lines.length - keepCount;
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
  const sanitize = (cell: string): string => {
    let text = cell.replace(/\r?\n/g, " ").replace(/(?<!\\)\|/g, "\\|");
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
