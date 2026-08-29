import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { IntegrityIssue } from "../../core/contracts/index.ts";
import { readBoundedBytes, readCanonicalObject, sha256Bytes } from "../../core/json.ts";
import { issue } from "./issues.ts";
import { isRecord, text, type JsonRecord } from "./layout-json.ts";

const PACKET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_PACKET_MARKDOWN_BYTES = 8 * 1024 * 1024;
const MAX_PACKET_METADATA_BYTES = 1024 * 1024;

function packetMetadataDisagrees(metadata: JsonRecord, record: JsonRecord): boolean {
  return (
    metadata.packet_sha256 !== record.packet_sha256 ||
    metadata.role !== record.role ||
    metadata.agent_id !== record.agent_id ||
    metadata.task_id !== record.task_id ||
    metadata.attempt !== record.attempt ||
    metadata.graph_revision !== record.graph_revision
  );
}

function packetBundleIssues(runRoot: string, id: string, record: JsonRecord): IntegrityIssue[] {
  if (!PACKET_ID_PATTERN.test(id))
    return [issue("PACKET_ID", `packet id is not safe to address: ${id}`, "packets")];
  const declaredMarkdown = text(record.markdown_path);
  const declaredMetadata = text(record.metadata_path);
  if (declaredMarkdown === undefined || declaredMetadata === undefined) return [];
  const bundleDir = join(runRoot, "packets", id);
  if (
    declaredMarkdown !== `packets/${id}/packet.md` ||
    declaredMetadata !== `packets/${id}/metadata.json`
  )
    return [issue("PACKET_PATH", `packet ${id} declares a path outside its own bundle`, bundleDir)];
  const found: IntegrityIssue[] = [];
  let present: boolean;
  try {
    present = lstatSync(bundleDir).isDirectory();
  } catch {
    present = false;
  }
  if (!present) {
    if (text(record.status) === "published")
      found.push(
        issue("PACKET_BUNDLE_MISSING", `published packet has no bundle on disk: ${id}`, bundleDir),
      );
    return found;
  }
  let names: string[];
  try {
    names = readdirSync(bundleDir).sort();
  } catch (error) {
    found.push(
      issue("PACKET_UNREADABLE", `packets/${id} is unreadable: ${String(error)}`, bundleDir),
    );
    return found;
  }
  if (names.join("\n") !== "metadata.json\npacket.md")
    found.push(
      issue(
        "PACKET_BUNDLE_SHAPE",
        `packet bundle does not hold exactly packet.md and metadata.json: ${id}`,
        bundleDir,
      ),
    );
  const markdownPath = join(bundleDir, "packet.md");
  try {
    const markdown = readBoundedBytes(markdownPath, MAX_PACKET_MARKDOWN_BYTES);
    const recordedDigest = text(record.packet_sha256);
    if (recordedDigest === undefined)
      found.push(
        issue(
          "PACKET_DIGEST",
          `packet ${id} has no recorded digest to check against`,
          markdownPath,
        ),
      );
    else if (sha256Bytes(markdown) !== recordedDigest)
      found.push(
        issue(
          "PACKET_CONTENT",
          `packet ${id} markdown no longer matches its recorded digest`,
          markdownPath,
        ),
      );
    if ((statSync(markdownPath).mode & 0o222) !== 0)
      found.push(issue("PACKET_MODE", `packet ${id} markdown is writable`, markdownPath));
  } catch (error) {
    found.push(
      issue(
        "PACKET_UNREADABLE",
        `packet ${id} markdown is unreadable: ${String(error)}`,
        markdownPath,
      ),
    );
  }
  const metadataPath = join(bundleDir, "metadata.json");
  try {
    const metadata = readCanonicalObject(metadataPath, `packet ${id} metadata`, {
      maxBytes: MAX_PACKET_METADATA_BYTES,
      maxDepth: 32,
    });
    if (packetMetadataDisagrees(metadata, record))
      found.push(
        issue(
          "PACKET_METADATA",
          `packet ${id} metadata disagrees with the recorded packet`,
          metadataPath,
        ),
      );
  } catch (error) {
    found.push(
      issue(
        "PACKET_UNREADABLE",
        `packet ${id} metadata is unreadable: ${String(error)}`,
        metadataPath,
      ),
    );
  }
  return found;
}

export function packetLayout(runRoot: string, state: JsonRecord | undefined): IntegrityIssue[] {
  const found: IntegrityIssue[] = [];
  const declared = isRecord(state?.packets) ? (state.packets as JsonRecord) : {};
  const declaredIds = new Set<string>();
  for (const [id, value] of Object.entries(declared)) {
    if (!isRecord(value)) continue;
    declaredIds.add(id);
    found.push(...packetBundleIssues(runRoot, id, value));
  }
  const root = join(runRoot, "packets");
  if (!existsSync(root)) return found;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (error) {
    found.push(issue("PACKET_UNREADABLE", `packets/ is unreadable: ${String(error)}`, root));
    return found;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (declaredIds.has(name)) continue;
    found.push(
      issue(
        "PACKET_UNDECLARED",
        `packet bundle is not registered in state: packets/${name}`,
        join(root, name),
      ),
    );
  }
  return found;
}
