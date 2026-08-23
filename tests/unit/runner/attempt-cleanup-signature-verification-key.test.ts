import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { verificationKey } from "../../../olt/scripts/src/runner/attempt-cleanup-signature.ts";

describe("verificationKey key-type guard", () => {
  test("rejects a well-formed, correctly canonical public key of a non-ed25519 type", () => {
    // An EC P-256 SPKI public key is well under the 128-byte budget and round-trips through DER
    // encode/decode cleanly, so it passes every earlier check and is rejected purely on
    // asymmetricKeyType, exercising the key-type guard that ed25519-only keys never reach.
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const der = publicKey.export({ format: "der", type: "spki" });
    expect(der.byteLength).toBeLessThan(128);
    expect(verificationKey(der.toString("base64"))).toBeUndefined();
  });

  test("rejects bytes that pass the size and base64 checks but are not valid DER/SPKI at all", () => {
    // Well-formed base64, in-budget size, but not a parseable ASN.1 structure: createPublicKey
    // throws, and that throw must be caught and turned into `undefined`, not propagate.
    const garbage = Buffer.alloc(32, 0xff).toString("base64");
    expect(verificationKey(garbage)).toBeUndefined();
  });
});
