import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_REPO_SECRET,
  assertEnvelopeIntegrity,
  canonicalEnvelopeBytes,
  createSignedEnvelope,
  verifyEnvelopeHmac,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type {
  CreateEnvelopeOptions,
  MailboxEnvelope,
} from "../../../olt/scripts/src/communication/types.ts";

describe("Mailbox Envelope Cryptographic Serialization & Verification", () => {
  const originalEnvSecret = process.env.OLT_HMAC_SECRET;

  beforeEach(() => {
    delete process.env.OLT_HMAC_SECRET;
  });

  afterEach(() => {
    if (originalEnvSecret !== undefined) {
      process.env.OLT_HMAC_SECRET = originalEnvSecret;
    } else {
      delete process.env.OLT_HMAC_SECRET;
    }
  });

  describe("canonicalEnvelopeBytes", () => {
    it("produces deterministic canonical bytes across arbitrary key permutations", () => {
      const objA = { z: 1, a: 2, m: 3 };
      const objB = { a: 2, m: 3, z: 1 };
      const objC = { m: 3, z: 1, a: 2 };
      const bytesA = canonicalEnvelopeBytes(objA);
      const bytesB = canonicalEnvelopeBytes(objB);
      const bytesC = canonicalEnvelopeBytes(objC);
      expect(bytesA).toEqual(bytesB);
      expect(bytesB).toEqual(bytesC);
      expect(new TextDecoder().decode(bytesA)).toBe('{"a":2,"m":3,"z":1}');
    });

    it("recursively sorts nested objects and preserves array ordering", () => {
      const complex1 = {
        outer: { delta: true, beta: [3, 2, 1], alpha: { sub2: "bar", sub1: "foo" } },
        count: 42,
      };
      const complex2 = {
        count: 42,
        outer: { alpha: { sub1: "foo", sub2: "bar" }, beta: [3, 2, 1], delta: true },
      };
      const bytes1 = canonicalEnvelopeBytes(complex1);
      const bytes2 = canonicalEnvelopeBytes(complex2);
      expect(bytes1).toEqual(bytes2);
      expect(new TextDecoder().decode(bytes1)).toBe(
        '{"count":42,"outer":{"alpha":{"sub1":"foo","sub2":"bar"},"beta":[3,2,1],"delta":true}}',
      );
    });

    it("omits undefined object properties and converts undefined in arrays to null", () => {
      const data = { present: "value", skipped: undefined, list: [1, undefined, 3] };
      const bytes = canonicalEnvelopeBytes(data);
      expect(new TextDecoder().decode(bytes)).toBe('{"list":[1,null,3],"present":"value"}');
    });

    it("handles primitives, booleans, and null deterministically", () => {
      expect(new TextDecoder().decode(canonicalEnvelopeBytes("hello"))).toBe('"hello"');
      expect(new TextDecoder().decode(canonicalEnvelopeBytes(123.45))).toBe("123.45");
      expect(new TextDecoder().decode(canonicalEnvelopeBytes(true))).toBe("true");
      expect(new TextDecoder().decode(canonicalEnvelopeBytes(false))).toBe("false");
      expect(new TextDecoder().decode(canonicalEnvelopeBytes(null))).toBe("null");
      expect(new TextDecoder().decode(canonicalEnvelopeBytes(undefined))).toBe("null");
    });

    it("handles objects with toJSON method such as Date instances", () => {
      const fixedDate = new Date("2026-08-29T12:00:00.000Z");
      const bytes = canonicalEnvelopeBytes({ timestamp: fixedDate });
      expect(new TextDecoder().decode(bytes)).toBe('{"timestamp":"2026-08-29T12:00:00.000Z"}');
    });

    it("throws TypeError on non-finite numbers, BigInt, or circular references", () => {
      expect(() => canonicalEnvelopeBytes(Number.NaN)).toThrow(TypeError);
      expect(() => canonicalEnvelopeBytes(Number.POSITIVE_INFINITY)).toThrow(TypeError);
      expect(() => canonicalEnvelopeBytes(BigInt(42))).toThrow(TypeError);
      expect(new TextDecoder().decode(canonicalEnvelopeBytes(() => {}))).toBe("null");
      expect(new TextDecoder().decode(canonicalEnvelopeBytes(Symbol("test")))).toBe("null");
      expect(new TextDecoder().decode(canonicalEnvelopeBytes([() => {}, Symbol("item")]))).toBe(
        "[null,null]",
      );
      const circularObj: { self?: object } = {};
      circularObj.self = circularObj;
      expect(() => canonicalEnvelopeBytes(circularObj)).toThrow(TypeError);
    });
  });

  describe("createSignedEnvelope and verifyEnvelopeHmac", () => {
    const sampleOptions: CreateEnvelopeOptions<{ taskId: string; action: string }> = {
      senderId: "agent-planner-01",
      senderRole: "planner",
      recipientId: "agent-implementer-02",
      messageType: "DISPATCH_TASK",
      payload: { taskId: "task-1.2", action: "build-envelope" },
    };

    it("creates a well-formed signed envelope with default secret and monotonic defaults", () => {
      const envelope = createSignedEnvelope(sampleOptions);
      expect(typeof envelope.id).toBe("string");
      expect(envelope.id.length).toBeGreaterThan(0);
      expect(envelope.sequence).toBe(1);
      expect(envelope.sender_id).toBe("agent-planner-01");
      expect(envelope.sender_role).toBe("planner");
      expect(envelope.recipient_id).toBe("agent-implementer-02");
      expect(envelope.message_type).toBe("DISPATCH_TASK");
      expect(envelope.correlation_id).toBe(envelope.id);
      expect(typeof envelope.timestamp).toBe("string");
      expect(envelope.payload).toEqual({ taskId: "task-1.2", action: "build-envelope" });
      expect(typeof envelope.hmac_signature).toBe("string");
      expect(envelope.hmac_signature.length).toBe(64);

      const verification = verifyEnvelopeHmac(envelope);
      expect(verification.valid).toBe(true);
      expect(verification.error).toBeUndefined();
    });

    it("honors custom sequence, correlationId, and explicit secretKey", () => {
      const customSecret = "custom-ultra-secure-key-999";
      const envelope = createSignedEnvelope({
        senderId: "agent-reviewer",
        senderRole: "reviewer",
        recipientId: "agent-planner",
        messageType: "VALIDATION_VERDICT",
        sequence: 42,
        correlationId: "corr-chain-777",
        secretKey: customSecret,
        payload: { note: "Approved" },
      });
      expect(envelope.sequence).toBe(42);
      expect(envelope.correlation_id).toBe("corr-chain-777");
      expect(verifyEnvelopeHmac(envelope, customSecret).valid).toBe(true);
      const invalid = verifyEnvelopeHmac(envelope, "wrong-key");
      expect(invalid.valid).toBe(false);
      expect(invalid.error).toContain("HMAC signature mismatch");
    });

    it("honors OLT_HMAC_SECRET environment variable when secretKey is omitted", () => {
      process.env.OLT_HMAC_SECRET = "env-injected-secret-key-123";
      const envelope = createSignedEnvelope(sampleOptions);
      expect(verifyEnvelopeHmac(envelope).valid).toBe(true);
      expect(verifyEnvelopeHmac(envelope, DEFAULT_REPO_SECRET).valid).toBe(false);
    });
  });

  describe("Tamper Resistance & Anti-Stub Verification", () => {
    it("detects tampered payload properties and returns valid: false", () => {
      const envelope = createSignedEnvelope({
        senderId: "source-node",
        senderRole: "dispatcher",
        recipientId: "dest-node",
        messageType: "DISPATCH_TASK",
        payload: { amount: 100, target: "account-a" },
      });
      const tampered: MailboxEnvelope<{ amount: number; target: string }> = {
        ...envelope,
        payload: { amount: 999999, target: "account-a" },
      };
      const result = verifyEnvelopeHmac(tampered);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("HMAC signature mismatch");
    });

    it("detects tampered sender_id, message_type, sequence, and recipient_id", () => {
      const envelope = createSignedEnvelope({
        senderId: "legit-agent",
        senderRole: "worker",
        recipientId: "boss-agent",
        messageType: "PULSE_HEARTBEAT",
        sequence: 10,
        payload: { status: "alive" },
      });
      expect(verifyEnvelopeHmac({ ...envelope, sender_id: "imposter" }).valid).toBe(false);
      expect(
        verifyEnvelopeHmac({ ...envelope, message_type: "DEFECT_ESCALATION" as const }).valid,
      ).toBe(false);
      expect(verifyEnvelopeHmac({ ...envelope, sequence: 11 }).valid).toBe(false);
      expect(verifyEnvelopeHmac({ ...envelope, recipient_id: "wrong-boss" }).valid).toBe(false);
      expect(verifyEnvelopeHmac({ ...envelope, timestamp: "2099-01-01T00:00:00.000Z" }).valid).toBe(
        false,
      );
      expect(
        verifyEnvelopeHmac({ ...envelope, correlation_id: "hijacked-correlation-id" }).valid,
      ).toBe(false);
    });

    it("rejects malformed signature, non-object, and missing signature", () => {
      const envelope = createSignedEnvelope({
        senderId: "src",
        senderRole: "role",
        recipientId: "dst",
        messageType: "PULSE_HEARTBEAT",
        payload: {},
      });
      expect(verifyEnvelopeHmac({ ...envelope, hmac_signature: "deadbeef00112233" }).valid).toBe(
        false,
      );
      expect(
        verifyEnvelopeHmac({ ...envelope, hmac_signature: "not_a_valid_hex_string!!" }).valid,
      ).toBe(false);
      expect(verifyEnvelopeHmac({ ...envelope, hmac_signature: "" }).valid).toBe(false);
      expect(verifyEnvelopeHmac(null as unknown as MailboxEnvelope).valid).toBe(false);
      expect(verifyEnvelopeHmac("not-an-object" as unknown as MailboxEnvelope).valid).toBe(false);
      const withInjected = { ...envelope, unauthorized_injected_metadata: "evil" };
      expect(verifyEnvelopeHmac(withInjected as unknown as MailboxEnvelope).valid).toBe(false);

      const circularPayload: { cycle?: object } = {};
      circularPayload.cycle = circularPayload;
      const withCircular = { ...envelope, payload: circularPayload };
      const verifyRes = verifyEnvelopeHmac(withCircular as unknown as MailboxEnvelope);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.error).toContain("Verification error");
    });
  });

  describe("assertEnvelopeIntegrity", () => {
    it("does not throw on a valid unmodified envelope", () => {
      const envelope = createSignedEnvelope({
        senderId: "agent-a",
        senderRole: "worker",
        recipientId: "agent-b",
        messageType: "HANDOFF_RECEIPT",
        payload: { success: true },
      });
      expect(() => assertEnvelopeIntegrity(envelope)).not.toThrow();
    });

    it("throws HarnessError with code INTEGRITY when envelope is tampered", () => {
      const envelope = createSignedEnvelope({
        senderId: "agent-a",
        senderRole: "worker",
        recipientId: "agent-b",
        messageType: "COGNITIVE_PUSHBACK",
        payload: { reason: "Initial critique" },
      });
      const tampered = { ...envelope, payload: { reason: "Tampered critique" } };
      expect(() => assertEnvelopeIntegrity(tampered)).toThrow(HarnessError);

      try {
        assertEnvelopeIntegrity(tampered);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INTEGRITY");
        expect(harnessErr.message).toContain("Mailbox envelope failed HMAC integrity verification");
      }
    });
  });

  describe("Code Invariants & File Limits", () => {
    it("ensures envelope.ts, index.ts, and test suite are <= 300 physical lines", () => {
      const rootDir = join(process.cwd());
      const files = [
        "olt/scripts/src/communication/mailbox/envelope.ts",
        "olt/scripts/src/communication/mailbox/index.ts",
        "tests/communication/envelope/envelope.test.ts",
      ];
      for (const file of files) {
        const lines = readFileSync(join(rootDir, file), "utf-8").split("\n").length;
        expect(lines).toBeLessThanOrEqual(300);
      }
    });

    it("ensures zero TypeScript 'any' and zero compiler suppressions in envelope source", () => {
      const rootDir = join(process.cwd());
      const envelopePath = join(rootDir, "olt/scripts/src/communication/mailbox/envelope.ts");
      const content = readFileSync(envelopePath, "utf-8");
      expect(content).not.toContain("@ts-ignore");
      expect(content).not.toContain("@ts-expect-error");
      expect(content).not.toContain("@ts-nocheck");
      expect(content).not.toMatch(/:\s*any\b/);
      expect(content).not.toMatch(/as\s+any\b/);
    });
  });
});
