import { assertRepositoryRelativePosixPath } from "../core/index.ts";

export interface IndexedBlob {
  readonly path: string;
  readonly oid: string;
  readonly bytes: Uint8Array;
}

export type GitCommandPrefix = readonly [string, ...string[]];

interface IndexEntry {
  readonly path: string;
  readonly oid: string;
}

const INDEX_RECORD = /^(100644|100755|120000) ([0-9a-f]{40}|[0-9a-f]{64}) [0-3]\t([\s\S]+)$/;
const BATCH_HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) blob ([0-9]+)$/;
const DEFAULT_GIT_COMMAND: GitCommandPrefix = ["git"];

async function collect(process: Bun.Subprocess<"pipe", "pipe", "ignore">): Promise<{
  readonly status: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}> {
  const [status, output, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
  ]);
  return { status, stdout: new Uint8Array(output), stderr };
}

function failure(message: string): never {
  throw new Error(`Unable to read Git index: ${message}`);
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function gitArguments(
  gitCommand: GitCommandPrefix,
  repoRoot: string,
  args: readonly string[],
): string[] {
  return [...gitCommand, "-C", repoRoot, ...args];
}

function parseIndexRecords(output: Uint8Array): readonly IndexEntry[] {
  const records = new TextDecoder("utf-8", { fatal: true }).decode(output).split("\0");
  if (records.pop() !== "") failure("ls-files output was not NUL-terminated");

  const paths = new Set<string>();
  return records
    .map((record) => {
      const match = INDEX_RECORD.exec(record);
      if (!match) failure(`malformed ls-files record: ${record}`);
      const [, , oid, path] = match;
      assertRepositoryRelativePosixPath(path);
      if (paths.has(path)) failure(`duplicate index path: ${path}`);
      paths.add(path);
      return { oid, path };
    })
    .sort((left, right) => comparePaths(left.path, right.path));
}

function parseBatch(output: Uint8Array, entries: readonly IndexEntry[]): readonly IndexedBlob[] {
  const blobs: IndexedBlob[] = [];
  let offset = 0;
  for (const entry of entries) {
    const newline = output.indexOf(10, offset);
    if (newline < 0) failure(`missing cat-file header for ${entry.path}`);
    const header = new TextDecoder("utf-8", { fatal: true }).decode(
      output.subarray(offset, newline),
    );
    const match = BATCH_HEADER.exec(header);
    if (!match || match[1] !== entry.oid) failure(`malformed cat-file header for ${entry.path}`);
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size)) failure(`invalid cat-file size for ${entry.path}`);
    offset = newline + 1;
    const end = offset + size;
    if (end > output.length || output[end] !== 10)
      failure(`truncated cat-file blob for ${entry.path}`);
    blobs.push({ path: entry.path, oid: entry.oid, bytes: output.slice(offset, end) });
    offset = end + 1;
  }
  if (offset !== output.length) failure("cat-file returned unexpected trailing data");
  return blobs;
}

export async function readIndexedBlobs(
  repoRoot: string,
  gitCommand: GitCommandPrefix = DEFAULT_GIT_COMMAND,
): Promise<readonly IndexedBlob[]> {
  const list = Bun.spawn(gitArguments(gitCommand, repoRoot, ["ls-files", "-s", "-z"]), {
    stdout: "pipe",
    stderr: "pipe",
  });
  const listed = await collect(list);
  if (listed.status !== 0) failure(listed.stderr.trim() || "git ls-files failed");
  const entries = parseIndexRecords(listed.stdout);
  if (entries.length === 0) return [];

  const batch = Bun.spawn(gitArguments(gitCommand, repoRoot, ["cat-file", "--batch"]), {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  batch.stdin.write(entries.map((entry) => `${entry.oid}\n`).join(""));
  batch.stdin.end();
  const result = await collect(batch);
  if (result.status !== 0) failure(result.stderr.trim() || "git cat-file failed");
  return parseBatch(result.stdout, entries);
}
