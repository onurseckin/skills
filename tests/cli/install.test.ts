import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanInstallerFixtures, installerFixture } from "../installer/helpers.ts";

afterEach(cleanInstallerFixtures);

describe("CLI installation", () => {
  test("installs and reports requested discovery clients", async () => {
    const fixture = await installerFixture();
    const installed = await execute([
      "install",
      "--source",
      fixture.source,
      "--home",
      fixture.home,
      "--clients",
      "codex,chatgpt,claude,antigravity",
    ]);
    expect(installed.destination).toContain(".agents/skills/orchestrating-long-tasks");
    const status = await execute([
      "installation-status",
      "--source",
      fixture.source,
      "--home",
      fixture.home,
      "--clients",
      "codex,chatgpt,claude,antigravity",
    ]);
    expect(status).toMatchObject({ installed: true, drifted: false, issues: [] });
  });

  test("rejects blank and duplicate client names", async () => {
    const fixture = await installerFixture();
    await expect(
      execute([
        "install",
        "--source",
        fixture.source,
        "--home",
        fixture.home,
        "--clients",
        "claude,,codex",
      ]),
    ).rejects.toThrow("clients");
    await expect(
      execute([
        "install",
        "--source",
        fixture.source,
        "--home",
        fixture.home,
        "--clients",
        "claude,claude",
      ]),
    ).rejects.toThrow("duplicate");
  });
});
