export function enforceLineLimit(markdown: string, maxLines = 30): string {
  const lines = markdown.trimEnd().split("\n");
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }
  const keepCount = maxLines - 2;
  const truncated = lines.slice(0, keepCount);
  const remainingCount = lines.length - keepCount;
  truncated.push("");
  truncated.push(`*... [truncated ${remainingCount} additional lines; use --all or query specific task for full details]*`);
  return truncated.slice(0, maxLines).join("\n");
}

export function formatTable(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => ":---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, separatorLine, ...rowLines];
}
