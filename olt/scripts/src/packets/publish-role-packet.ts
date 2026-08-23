import type { Clock, TransactionPort } from "../workflow/types.ts";
import { systemClock } from "../workflow/types.ts";
import type { PacketAuthorization, PublishedPacket } from "./persist-packet.ts";
import { publishPacket } from "./persist-packet.ts";
import { buildPacketFromPinnedRuntime } from "./render-packet.ts";
import type { BuiltPacket, PacketInput } from "./types.ts";

export async function publishRolePacket(
  runRoot: string,
  packetId: string,
  input: Omit<PacketInput, "commonInstructions">,
  port: TransactionPort,
  authorization: PacketAuthorization,
  clock: Clock = systemClock,
): Promise<PublishedPacket & { packet: BuiltPacket }> {
  const packet = await buildPacketFromPinnedRuntime(runRoot, input);
  const published = await publishPacket(runRoot, packetId, packet, port, authorization, clock);
  return { ...published, packet };
}
