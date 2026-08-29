import { categorizeDefect } from "../../defects/index.ts";
import type { PushbackRecord, PushbackItem } from "./types.ts";
import { parseInvariantsTable } from "./resolver.ts";

export function parsePushbackMarkdown(content: string): PushbackRecord[] {
  if (typeof content !== "string" || !content.trim()) {
    return [];
  }

  const lines = content.split("\n");
  const records: PushbackRecord[] = [];

  let currentSectionTitle = "";
  let currentPushbackNum: number | undefined = undefined;
  let currentGenNum: number | undefined = undefined;
  let lastKnownGenNum: number | undefined = undefined;
  let currentSectionLines: string[] = [];

  const flushSection = () => {
    if (!currentSectionTitle && currentSectionLines.length === 0) {
      return;
    }

    const items: PushbackItem[] = [];
    const invariants = parseInvariantsTable(currentSectionLines);

    const effectiveGenNum =
      currentGenNum !== undefined
        ? currentGenNum
        : invariants.length > 0 && lastKnownGenNum !== undefined
          ? lastKnownGenNum
          : undefined;

    for (let j = 0; j < currentSectionLines.length; j += 1) {
      const line = currentSectionLines[j];
      if (line === undefined) {
        continue;
      }
      const trimmed = line.trim();

      const itemMatch = trimmed.match(
        /^(?:[-*]|\d+\.)\s+\*\*(?:Pushback Item|Item|\d+)?\s*(?:(\d+)|([^*]+))\*\*:\s*(.*)$/i,
      );

      const objectiveMatch = trimmed.match(/^\d+\.\s+\*\*(.+?)\*\*\s*(?:\((.+?)\))?:\s*(.*)$/);

      if (itemMatch || objectiveMatch) {
        const itemTitle = itemMatch
          ? (itemMatch[2] ?? itemMatch[1] ?? "").trim()
          : objectiveMatch
            ? (objectiveMatch[1] ?? "").trim()
            : "";
        let issue = itemMatch && itemMatch[3] ? itemMatch[3].trim() : "";
        let resolution = "";

        for (let k = j + 1; k < Math.min(j + 15, currentSectionLines.length); k += 1) {
          const subLine = currentSectionLines[k];
          if (subLine === undefined) {
            break;
          }
          const subTrimmed = subLine.trim();

          if (
            subTrimmed.startsWith("###") ||
            subTrimmed.startsWith("##") ||
            subTrimmed.match(/^(?:[-*]|\d+\.)\s+\*\*(?:Pushback Item|Item|\d+)/i)
          ) {
            break;
          }

          if (
            subTrimmed.toLowerCase().includes("*issue*:") ||
            subTrimmed.toLowerCase().includes("**issue**:")
          ) {
            const issuePart = subTrimmed.split(/:/i)[1];
            if (issuePart) {
              issue = issuePart.replace(/\*/g, "").trim();
            }
          } else if (
            subTrimmed.toLowerCase().includes("*resolution*:") ||
            subTrimmed.toLowerCase().includes("**resolution**:")
          ) {
            const resPart = subTrimmed.split(/:/i)[1];
            if (resPart) {
              resolution = resPart.replace(/\*/g, "").trim();
            }
          } else if (subTrimmed.startsWith("-") && !issue && !resolution) {
            const bulletContent = subTrimmed.slice(1).trim();
            if (bulletContent) {
              if (!issue) {
                issue = bulletContent;
              } else if (!resolution) {
                resolution = bulletContent;
              }
            }
          }
        }

        if (itemTitle || issue || resolution) {
          const inferredCategory = categorizeDefect({
            type: itemTitle,
            observation: issue,
            remediation: resolution,
          });

          items.push({
            title: itemTitle || undefined,
            issue: issue || itemTitle || "Pushback requirement",
            resolution: resolution || "Remediate pushback violation",
            category: inferredCategory,
          });
        }
      }
    }

    if (items.length === 0 && (currentPushbackNum !== undefined || effectiveGenNum !== undefined)) {
      const firstFewLines = currentSectionLines
        .filter((l) => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("|"))
        .slice(0, 3)
        .join(" ");

      items.push({
        title: currentSectionTitle,
        issue: firstFewLines || currentSectionTitle,
        resolution: "Satisfy all canonical invariants for this generation",
        category: categorizeDefect({
          type: currentSectionTitle,
          observation: firstFewLines,
          remediation: "Satisfy all canonical invariants",
        }),
      });
    }

    if (effectiveGenNum !== undefined) {
      const existingGenIdx = records.findIndex(
        (r) => r.generation === effectiveGenNum && r.pushback_number === undefined,
      );
      if (existingGenIdx !== -1) {
        const existingRec = records[existingGenIdx];
        if (existingRec !== undefined) {
          records[existingGenIdx] = {
            ...existingRec,
            title: existingRec.title.includes("Convergence")
              ? existingRec.title
              : currentSectionTitle,
            items: [...existingRec.items, ...items],
            invariants: [...existingRec.invariants, ...invariants],
            raw_section: `${existingRec.raw_section ?? ""}\n\n${currentSectionLines.join("\n")}`,
          };
          return;
        }
      }
    }

    records.push({
      ...(currentPushbackNum !== undefined ? { pushback_number: currentPushbackNum } : {}),
      ...(effectiveGenNum !== undefined ? { generation: effectiveGenNum } : {}),
      title: currentSectionTitle,
      items,
      invariants,
      raw_section: currentSectionLines.join("\n"),
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (rawLine === undefined) {
      continue;
    }
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      flushSection();
      currentSectionTitle = trimmed.replace(/^#{2,3}\s+/, "").trim();
      currentSectionLines = [rawLine];

      const pushbackMatch = currentSectionTitle.match(/Pushback\s*#?(\d+)/i);
      currentPushbackNum =
        pushbackMatch && pushbackMatch[1] ? Number.parseInt(pushbackMatch[1], 10) : undefined;

      const genMatch = currentSectionTitle.match(/Generation\s*(\d+)/i);
      currentGenNum = genMatch && genMatch[1] ? Number.parseInt(genMatch[1], 10) : undefined;
      if (currentGenNum !== undefined) {
        lastKnownGenNum = currentGenNum;
      }
    } else {
      currentSectionLines.push(rawLine);
    }
  }

  flushSection();

  return records;
}
