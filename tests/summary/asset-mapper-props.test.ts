import { describe, expect, test } from "bun:test";
import {
  getMimeTypeForUrl,
  inferAssetProps,
} from "../../../olt/scripts/src/summary/assets/index.ts";
import { makeCommand, makeTask } from "./graph-fixtures.ts";

describe("getMimeTypeForUrl", () => {
  test("trusts an explicit MIME type over the url's own extension", () => {
    expect(getMimeTypeForUrl("evidence/shot.png", "image/vnd.custom")).toBe("image/vnd.custom");
  });

  test("falls back to sniffing the extension when the explicit MIME type is blank or absent", () => {
    expect(getMimeTypeForUrl("evidence/shot.gif", "   ")).toBe("image/gif");
    expect(getMimeTypeForUrl("evidence/shot.bmp")).toBe("image/bmp");
  });
});

describe("inferAssetProps: every extension gets its own type, MIME and title", () => {
  test.each([
    ["jpg", "image", "image/jpeg"],
    ["jpeg", "image", "image/jpeg"],
    ["webp", "image", "image/webp"],
    ["gif", "image", "image/gif"],
    ["bmp", "image", "image/bmp"],
    ["mp4", "video", "video/mp4"],
    ["log", "log", "text/plain"],
    ["zip", "image", "image/png"],
  ] as const)("%s -> type %s, mime %s", (ext, expectedType, expectedMime) => {
    const props = inferAssetProps(`evidence/artifact.${ext}`);
    expect(props.type).toBe(expectedType);
    expect(props.mimeType).toBe(expectedMime);
  });

  test("titles a video as a Test Recording and an unrecognised extension as a plain Artifact", () => {
    expect(inferAssetProps("evidence/run.mp4").title).toBe("Test Recording: run.mp4");
    expect(inferAssetProps("evidence/run.log").title).toBe("Execution Log: run.log");
    expect(inferAssetProps("evidence/run.zip").title).toBe("Artifact: run.zip");
  });

  test("stages as validation only for a command belonging to the resolved validator, execution otherwise", () => {
    const task = makeTask("T-1", {
      validations: [
        {
          validator_id: "val-1",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
        },
      ],
    });
    const validatorCmd = makeCommand("C-v", { actor: "val-1" });
    const implementerCmd = makeCommand("C-i", { actor: "worker-1" });

    expect(inferAssetProps("shot.png", validatorCmd, task).stage).toBe("validation");
    expect(inferAssetProps("shot.png", implementerCmd, task).stage).toBe("execution");
    expect(inferAssetProps("shot.png", implementerCmd, task).description).toBe(
      "Captured during test execution for command C-i",
    );
    expect(inferAssetProps("shot.png").description).toBe("Evidence captured for task run");
  });
});
