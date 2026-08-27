import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

interface FakeGitBehavior {
  readonly lsFilesOutput: string;
  readonly lsFilesStatus?: number;
  readonly catFileOutput?: string;
  readonly catFileStatus?: number;
}

export interface FakeGitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const INVENTORY_ENTRY =
  "/Users/onurseckinsenoglu/repos/skills/scripts/modularity/inventory/index.ts";

function executableSource(behavior: FakeGitBehavior): string {
  const lsFilesStatus = behavior.lsFilesStatus ?? 0;
  const catFileStatus = behavior.catFileStatus ?? 0;
  return `#!/bin/sh
if [ "$3" = "ls-files" ]; then
  printf '${behavior.lsFilesOutput}'
  exit ${lsFilesStatus}
fi
if [ "$3" = "cat-file" ]; then
  printf '${behavior.catFileOutput ?? ""}'
  exit ${catFileStatus}
fi
exit 99
`;
}

export async function runInventoryWithFakeGit(
  repoRoot: string,
  behavior: FakeGitBehavior,
): Promise<FakeGitResult> {
  const bin = await mkdtemp(join(tmpdir(), "modularity-fake-git-"));
  const executable = join(bin, "git");
  await writeFile(executable, executableSource(behavior));
  await chmod(executable, 0o755);

  const script = `import { readIndexedBlobs } from ${JSON.stringify(INVENTORY_ENTRY)};
try { console.log(JSON.stringify((await readIndexedBlobs(${JSON.stringify(repoRoot)})).map(({ path }) => path))); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}`;
  try {
    const child = Bun.spawn(["bun", "--eval", script], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { status, stdout, stderr };
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
}
