import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeDecoupledBlob, readDecoupledBlob } from "../../../src/packets/capsule-memory.ts";

describe("Planning Disk Persistence", () => {
  let capsuleRoot: string;

  beforeEach(async () => {
    const tmpBase = join(process.cwd(), ".tmp");
    await mkdir(tmpBase, { recursive: true });
    capsuleRoot = await mkdtemp(join(tmpBase, "disk-persistence-test-"));
  });

  afterEach(async () => {
    await rm(capsuleRoot, { recursive: true, force: true });
  });

  it("should write a blob to disk and read it back correctly", async () => {
    const content = JSON.stringify({
      plan: "test-plan",
      tasks: [{ id: "task-1" }],
    });

    const writeResult = await writeDecoupledBlob(capsuleRoot, content, "plan");
    expect(writeResult.hash).toBeDefined();
    expect(writeResult.path).toContain("plan-");

    const readBuffer = await readDecoupledBlob(capsuleRoot, writeResult.hash);
    expect(readBuffer).toBeDefined();
    expect(readBuffer!.toString("utf-8")).toBe(content);
  });
});
