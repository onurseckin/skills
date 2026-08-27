import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function gitInFixture(repo: string, args: readonly string[]): Promise<void> {
  const process = Bun.spawn(["git", "-C", repo, ...args], { stderr: "pipe" });
  if ((await process.exited) !== 0) {
    throw new Error(await new Response(process.stderr).text());
  }
}

export async function createIndexedFixture(options: {
  readonly staged: string;
  readonly working: string;
  readonly path?: string;
}): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "modularity-index-"));
  const path = options.path ?? "slice/index.ts";
  const target = join(repo, path);

  await gitInFixture(repo, ["init", "--quiet", "--initial-branch", "main"]);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, options.staged);
  await gitInFixture(repo, ["add", path]);
  await writeFile(target, options.working);
  return repo;
}

export async function removeIndexedFixture(repo: string): Promise<void> {
  await rm(repo, { recursive: true, force: true });
}

export async function stageFiles(
  repo: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const target = join(repo, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, contents);
    await gitInFixture(repo, ["add", path]);
  }
}
