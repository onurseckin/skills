export function stripYamlComment(line: string): string {
  let inSingle = false,
    inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      if (inSingle && line[i + 1] === "'") i++;
      else inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (inDouble && ch === "\\" && i + 1 < line.length) {
      i++;
    } else if (
      ch === "#" &&
      !inSingle &&
      !inDouble &&
      (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")
    ) {
      return line.slice(0, i);
    }
  }
  return line;
}

export function findColonKeyBoundary(line: string): number {
  let inSingle = false,
    inDouble = false,
    bracketDepth = 0,
    braceDepth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (inDouble && ch === "\\" && i + 1 < line.length) i++;
    else if (!inSingle && !inDouble) {
      if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth--;
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      else if (ch === ":" && bracketDepth === 0 && braceDepth === 0) {
        const next = line[i + 1];
        if (next === undefined || next === " " || next === "\t" || next === "\n" || next === "\r")
          return i;
      }
    }
  }
  return -1;
}

export function cleanYamlKey(keyPart: string): string {
  const trimmed = keyPart.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function splitFlowItems(inner: string): string[] {
  const items: string[] = [];
  let current = "",
    inSingle = false,
    inDouble = false,
    bracketDepth = 0,
    braceDepth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (inDouble && ch === "\\" && i + 1 < inner.length) {
      current += ch + inner[i + 1];
      i++;
      continue;
    } else if (!inSingle && !inDouble) {
      if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth--;
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      else if (ch === "," && bracketDepth === 0 && braceDepth === 0) {
        if (current.trim().length > 0) items.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim().length > 0) items.push(current.trim());
  return items;
}

export function parseFlowSequence(inner: string): unknown[] {
  return splitFlowItems(inner).map(parseYamlScalar);
}

export function parseFlowMapping(inner: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of splitFlowItems(inner)) {
    const colonIdx = findColonKeyBoundary(entry);
    if (colonIdx !== -1) {
      result[cleanYamlKey(entry.slice(0, colonIdx))] = parseYamlScalar(entry.slice(colonIdx + 1));
    }
  }
  return result;
}

export function parseYamlScalar(rawInput: string): unknown {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) return null;
  if (/^(true|True|TRUE|yes|Yes|YES|on|On|ON)$/.test(trimmed)) return true;
  if (/^(false|False|FALSE|no|No|NO|off|Off|OFF)$/.test(trimmed)) return false;
  if (/^(null|Null|NULL|~)$/.test(trimmed)) return null;

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner.length === 0 ? [] : parseFlowSequence(inner);
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner.length === 0 ? {} : parseFlowMapping(inner);
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t");
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }
  return trimmed;
}
