# Anti-Mock PNG IHDR Binary Inspection

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 09](./index.md) > 09-02 PNG Binary Inspection

---

[⏮️ Previous: 09-01 Falsifiable Evidence Classes](09-01-falsifiable-evidence-classes.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 09-03 APCA Perceptual Contrast Mathematics](09-03-apca-perceptual-contrast-mathematics.md)
---

## 1. PNG Chunk Verification & Shannon Entropy

Agents frequently generate 1x1 pixel fake images or blank solid-color PNG files to fake UI rendering proofs.

OLT inspects PNG files directly at the **binary byte level**:

1. **8-Byte Magic Header**: `89 50 4E 47 0D 0A 1A 0A`.
2. **IHDR Chunk**: Validates exact width, height, bit depth, and color type.
3. **Shannon Entropy Analysis**:

$$H(X) = -\sum_{i=1}^n P(x_i) \log_2 P(x_i)$$

A valid rendered UI screenshot has entropy $H(X) \ge 3.5$. Solid-color dummy files ($H(X) < 1.0$) are rejected with `MOCK_IMAGE_DETECTED`.

---

[⏮️ Previous: 09-01 Falsifiable Evidence Classes](09-01-falsifiable-evidence-classes.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 09-03 APCA Perceptual Contrast Mathematics](09-03-apca-perceptual-contrast-mathematics.md)
---
