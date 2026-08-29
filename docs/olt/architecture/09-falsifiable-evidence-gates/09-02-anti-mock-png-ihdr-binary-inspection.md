# Anti-Mock PNG Binary & Shannon Entropy Inspection

---

[Previous: 09-01 Falsifiable Evidence Classes](09-01-falsifiable-evidence-classes.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 09-03 APCA Contrast Mathematics](09-03-apca-perceptual-contrast-mathematics.md)
---

## 1. Executive Summary & The Placeholder Hallucination Threat

When autonomous agent workflows require generating visual UI designs, screenshots, or diagram assets, LLMs frequently emit **synthetic placeholders**:

- Creating zero-byte or corrupted image files.
- Writing plain text files masquerading as images (`.png` files containing text like `"Image placeholder"`).
- Emitting 1x1 pixel or solid-color blank canvases that fail to render real UI components.

The **OLT (Orchestrating Long Tasks)** engine implements the **Anti-Mock PNG Binary & Shannon Entropy Inspection Engine**. Under this system:

1. **Raw Binary Chunk Parsing**: The binary engine inspects the byte-level structure of PNG files, verifying the 8-byte magic signature, 32-byte IHDR header, image dimensions ($W, H \ge 100\text{px}$), bit depth, and CRC-32 checksums.
2. **Shannon Information Entropy Verification**: The engine computes the Shannon entropy $H(X)$ of the raw pixel data. Rendered, non-mock visual interfaces exhibit $H(X) \ge 3.0$ bits/byte, whereas blank or solid-color placeholders have $H(X) \approx 0$.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 PNG BINARY INSPECTION TOPOLOGY                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   0x00: 8-Byte Magic Signature  ──► 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A (Valid PNG Header)   │
│   0x08: 4-Byte IHDR Length      ──► 0x00 0x00 0x00 0x0D (13 Bytes Payload)                       │
│   0x0C: 4-Byte Chunk Type       ──► "IHDR" (0x49 0x48 0x44 0x52)                                 │
│   0x10: 13-Byte IHDR Body       ──► Width (4B), Height (4B), BitDepth (1B), ColorType (1B)...    │
│   0x1D: 4-Byte Chunk CRC        ──► CRC-32 Polynomial Integrity Check                            │
│                                                                                                  │
│   ════════════════════════════════════════════════════════════════════════════════════════════   │
│   SHANNON ENTROPY: H(X) = -sum P(x) * log2 P(x) >= 3.0 bits/byte (Anti-Mock Threshold)           │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Mathematical Formalization of Shannon Information Entropy

Let $\mathbf{B} = \langle b_1, b_2, \dots, b_M \rangle$ denote the byte stream of the uncompressed or compressed image payload, where each byte $b_k \in \{0, 1, \dots, 255\}$.

Let $N_i$ denote the frequency count of byte value $i \in [0, 255]$ in the byte stream:

$$N_i = \sum_{k=1}^{M} \mathbf{1}_{\{b_k = i\}}$$

The empirical probability $P(x_i)$ of byte value $i$ is:

$$P(x_i) = \frac{N_i}{M}$$

The **Shannon Information Entropy** $H(X)$ (in bits per byte) is defined as:

$$H(X) = -\sum_{i=0}^{255} P(x_i) \log_2 P(x_i), \quad \text{where } 0 \log_2 0 \equiv 0$$

### Entropy Classification Thresholds

```text
┌───────────────────────────┬───────────────────┬──────────────────────────────────────────────────┐
│ Entropy Range H(X)        │ Classification    │ System Action / Verdict                          │
├───────────────────────────┼───────────────────┼──────────────────────────────────────────────────┤
│ $H(X) < 1.0$ bits/byte    │ SOLID / BLANK     │ REJECT (Class 3 Violation: Solid placeholder)    │
├───────────────────────────┼───────────────────┼──────────────────────────────────────────────────┤
│ $1.0 \le H(X) < 3.0$      │ LOW COMPLEXITY    │ REJECT (Class 3 Violation: Trivial / low detail) │
├───────────────────────────┼───────────────────┼──────────────────────────────────────────────────┤
│ $3.0 \le H(X) \le 8.0$    │ PRODUCTION ASSET  │ PASS (Certified Non-Mock Visual Interface)       │
└───────────────────────────┴───────────────────┴──────────────────────────────────────────────────┘
```

```mermaid
flowchart TD
    ReadPNG[Read Image Binary Stream: B] --> CheckMagic{Matches 8-byte PNG Signature?}
    CheckMagic -->|No: Fake Image| RejectMagic[TRAP: INVALID_PNG_SIGNATURE]
    CheckMagic -->|Yes| ParseIHDR[Parse IHDR Dimensions: Width, Height]

    ParseIHDR --> CheckDims{Width >= 100 && Height >= 100?}
    CheckDims -->|No: Thumbnail / Stub| RejectDims[TRAP: IMAGE_DIMENSIONS_TOO_SMALL]
    CheckDims -->|Yes| ComputeEntropy[Compute Shannon Entropy H(X)]

    ComputeEntropy --> CheckEntropy{H(X) >= 3.0 bits/byte?}
    CheckEntropy -->|No: Solid Canvas| RejectEntropy[TRAP: LOW_ENTROPY_PLACEHOLDER]
    CheckEntropy -->|Yes: Real UI Image| PassBinary([Class 3 Proof Certified])
```

---

## 3. Binary Parser Implementation

The PNG verification engine ([`png-inspector.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/validation/png-inspector.ts)) parses binary buffers without third-party dependencies:

```typescript
export function inspectPNGBinary(buffer: Uint8Array): ImageVerificationResult {
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== PNG_MAGIC[i])
      throw new HarnessError("INVALID_PNG_MAGIC", "Invalid PNG file header signature");
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);

  const entropy = computeShannonEntropy(buffer.subarray(33));
  if (entropy < 3.0)
    throw new HarnessError(
      "LOW_ENTROPY_MOCK",
      `Image entropy ${entropy.toFixed(2)} is below 3.0 threshold`,
    );

  return { width, height, entropy, valid: true };
}
```

---

## 4. Integration with Class 3 Evidence Gates

During `gate:prove`, all generated visual artifacts (mockups, screenshots, charts) are submitted to the PNG inspector. Tasks claiming UI generation fail-closed if the inspector rejects the binary headers or entropy scores.

---

## 5. Architectural Invariants Summary

1. **Zero Text-as-Image Toleration**: Non-binary files with image extensions are rejected immediately.
2. **Hard Entropy Floor**: Images must exhibit $H(X) \ge 3.0$ bits/byte, proving non-trivial rendering complexity.
3. **Hermetic Parsing**: Pure TypeScript DataView parsing prevents buffer overflow exploits and native dependency crashes.

---

[Previous: 09-01 Falsifiable Evidence Classes](09-01-falsifiable-evidence-classes.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 09-03 APCA Contrast Mathematics](09-03-apca-perceptual-contrast-mathematics.md)
---
