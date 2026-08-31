import type { ParsedLine } from "./types.ts";
import {
  cleanYamlKey,
  findColonKeyBoundary,
  parseFlowMapping,
  parseFlowSequence,
  parseYamlScalar,
  stripYamlComment,
} from "./yaml-scalar.ts";

export {
  cleanYamlKey,
  findColonKeyBoundary,
  parseFlowMapping,
  parseFlowSequence,
  parseYamlScalar,
  stripYamlComment,
};

export function parseYaml(yamlText: string): unknown {
  const trimmed = yamlText.trim();
  if (trimmed.length === 0) return {};
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }

  const rawLines = yamlText.split(/\r?\n/);
  const parsedLines: ParsedLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i]!;
    const uncommented = stripYamlComment(rawLine);
    if (uncommented.trim().length === 0) continue;
    const match = /^[ \t]*/.exec(rawLine);
    const indent = match ? match[0].replace(/\t/g, "  ").length : 0;
    parsedLines.push({ originalLine: rawLine, indent, text: uncommented.trim(), lineNum: i });
  }

  if (parsedLines.length === 0) return {};
  if (
    parsedLines.length === 1 &&
    findColonKeyBoundary(parsedLines[0]!.text) === -1 &&
    !parsedLines[0]!.text.startsWith("-")
  ) {
    return parseYamlScalar(parsedLines[0]!.text);
  }

  let currentIdx = 0;

  function parseBlockScalar(allLines: string[], headerLineNum: number, indicator: string): string {
    const collected: string[] = [];
    let baseIndent: number | null = null,
      linePtr = headerLineNum + 1;
    while (linePtr < allLines.length) {
      const raw = allLines[linePtr]!;
      if (raw.trim().length === 0) {
        collected.push("");
        linePtr++;
        continue;
      }
      const match = /^[ \t]*/.exec(raw);
      const indent = match ? match[0].replace(/\t/g, "  ").length : 0;
      if (baseIndent === null) {
        const headerMatch = /^[ \t]*/.exec(allLines[headerLineNum]!);
        const headerIndent = headerMatch ? headerMatch[0].replace(/\t/g, "  ").length : 0;
        if (indent <= headerIndent) break;
        baseIndent = indent;
      }
      if (indent < baseIndent) break;
      collected.push(raw.length >= baseIndent ? raw.slice(baseIndent) : raw.trimStart());
      linePtr++;
    }
    while (currentIdx < parsedLines.length && parsedLines[currentIdx]!.lineNum < linePtr)
      currentIdx++;

    let resultText = "";
    if (indicator.startsWith(">")) {
      let buffer = "";
      for (const l of collected) {
        if (l.trim().length === 0) {
          if (buffer.length > 0) {
            resultText += (resultText.length > 0 ? "\n" : "") + buffer;
            buffer = "";
          }
          resultText += "\n";
        } else {
          buffer = buffer.length > 0 ? `${buffer} ${l.trim()}` : l.trim();
        }
      }
      if (buffer.length > 0) resultText += (resultText.length > 0 ? "\n" : "") + buffer;
    } else {
      resultText = collected.join("\n");
    }
    if (indicator.includes("-")) resultText = resultText.replace(/\n+$/, "");
    else if (!indicator.includes("+")) resultText = resultText.replace(/\n*$/, "\n");
    return resultText;
  }

  function parseAdditionalObjectKeys(target: Record<string, unknown>, minIndent: number): void {
    while (currentIdx < parsedLines.length) {
      const nextLine = parsedLines[currentIdx]!;
      if (nextLine.indent < minIndent || nextLine.text.startsWith("- ")) break;
      const colIdx = findColonKeyBoundary(nextLine.text);
      if (colIdx !== -1) {
        const nextKey = cleanYamlKey(nextLine.text.slice(0, colIdx));
        const nextValPart = nextLine.text.slice(colIdx + 1).trim();
        currentIdx++;
        if (/^(\|[-+]?|>[-+]?)$/.test(nextValPart)) {
          target[nextKey] = parseBlockScalar(rawLines, nextLine.lineNum, nextValPart);
        } else if (nextValPart.length === 0) {
          target[nextKey] =
            currentIdx < parsedLines.length && parsedLines[currentIdx]!.indent > nextLine.indent
              ? parseBlock(parsedLines[currentIdx]!.indent)
              : null;
        } else {
          target[nextKey] = parseYamlScalar(nextValPart);
        }
      } else {
        currentIdx++;
      }
    }
  }

  function parseBlock(currentIndent: number): unknown {
    if (currentIdx >= parsedLines.length) return null;
    const firstLine = parsedLines[currentIdx]!;

    if (firstLine.text === "-" || firstLine.text.startsWith("- ")) {
      const list: unknown[] = [];
      while (currentIdx < parsedLines.length) {
        const line = parsedLines[currentIdx]!;
        if (line.indent < currentIndent) break;

        if (line.text === "-" || line.text.startsWith("- ")) {
          const itemText = line.text === "-" ? "" : line.text.slice(2).trim();
          currentIdx++;
          if (itemText.length === 0) {
            list.push(
              currentIdx < parsedLines.length && parsedLines[currentIdx]!.indent > line.indent
                ? parseBlock(parsedLines[currentIdx]!.indent)
                : null,
            );
          } else {
            const colonBoundary = findColonKeyBoundary(itemText);
            if (colonBoundary !== -1) {
              const k = cleanYamlKey(itemText.slice(0, colonBoundary));
              const afterColon = itemText.slice(colonBoundary + 1).trim();
              if (/^(\|[-+]?|>[-+]?)$/.test(afterColon)) {
                const obj: Record<string, unknown> = {
                  [k]: parseBlockScalar(rawLines, line.lineNum, afterColon),
                };
                parseAdditionalObjectKeys(obj, line.indent + 2);
                list.push(obj);
              } else if (afterColon.length === 0) {
                let childObj: Record<string, unknown> = {};
                if (
                  currentIdx < parsedLines.length &&
                  parsedLines[currentIdx]!.indent > line.indent
                ) {
                  const nested = parseBlock(parsedLines[currentIdx]!.indent);
                  childObj =
                    typeof nested === "object" && nested !== null && !Array.isArray(nested)
                      ? { [k]: nested, ...(nested as Record<string, unknown>) }
                      : { [k]: nested };
                } else {
                  childObj = { [k]: null };
                }
                list.push(childObj);
              } else {
                const obj: Record<string, unknown> = { [k]: parseYamlScalar(afterColon) };
                parseAdditionalObjectKeys(obj, line.indent + 2);
                list.push(obj);
              }
            } else {
              list.push(parseYamlScalar(itemText));
            }
          }
        } else if (line.indent >= currentIndent) {
          currentIdx++;
        } else {
          break;
        }
      }
      return list;
    }

    const obj: Record<string, unknown> = {};
    while (currentIdx < parsedLines.length) {
      const line = parsedLines[currentIdx]!;
      if (line.indent < currentIndent) break;
      const colonIdx = findColonKeyBoundary(line.text);
      if (colonIdx === -1) {
        currentIdx++;
        continue;
      }
      const key = cleanYamlKey(line.text.slice(0, colonIdx));
      const valuePart = line.text.slice(colonIdx + 1).trim();
      currentIdx++;
      if (/^(\|[-+]?|>[-+]?)$/.test(valuePart)) {
        obj[key] = parseBlockScalar(rawLines, line.lineNum, valuePart);
      } else if (valuePart.length === 0) {
        obj[key] =
          currentIdx < parsedLines.length && parsedLines[currentIdx]!.indent > line.indent
            ? parseBlock(parsedLines[currentIdx]!.indent)
            : null;
      } else {
        obj[key] = parseYamlScalar(valuePart);
      }
    }
    return obj;
  }

  const result = parseBlock(0);
  return result ?? {};
}
