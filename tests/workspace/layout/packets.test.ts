import { describe, expect, it } from "bun:test";
import { packetLayout } from "../../../olt/scripts/src/engine/store/layout/layout-packets.ts";

describe("Workspace Layout: Packets Layout & Mailbox Isolation", () => {
  it("evaluates clean state with empty packets list", () => {
    const issues = packetLayout("/tmp/run-root", { packets: {} });
    expect(issues.length).toBe(0);
  });

  it("evaluates undefined state gracefully", () => {
    const issues = packetLayout("/tmp/run-root", undefined);
    expect(issues.length).toBe(0);
  });

  it("detects invalid packet ID characters", () => {
    const state = {
      packets: {
        "invalid packet id!": {
          markdown_path: "packets/invalid/packet.md",
          metadata_path: "packets/invalid/metadata.json",
        },
      },
    };
    const issues = packetLayout("/tmp/run-root", state);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].code).toBe("PACKET_ID");
  });

  it("detects packet path escaping its bundle directory", () => {
    const state = {
      packets: {
        "packet-01": {
          markdown_path: "packets/other-packet/packet.md",
          metadata_path: "packets/packet-01/metadata.json",
        },
      },
    };
    const issues = packetLayout("/tmp/run-root", state);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].code).toBe("PACKET_PATH");
  });
});
