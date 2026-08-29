# APCA Perceptual Contrast Mathematics ($L_c$)

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 09](./index.md) > 09-03 APCA Contrast Math

---

[⏮️ Previous: 09-02 Anti-Mock PNG IHDR Binary Inspection](09-02-anti-mock-png-ihdr-binary-inspection.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 09-04 Gate Prove & Terminal Run Sealing](09-04-gate-prove-and-terminal-completion.md)
---

## 1. The Accessible Perceptual Contrast Algorithm (APCA)

Traditional WCAG 2.1 contrast formulas ($(\mathcal{L}_1 + 0.05) / (\mathcal{L}_2 + 0.05)$) fail on modern displays and dark mode. OLT implements the **APCA W3C Candidate Standard**.

```text
  sRGB Input (R, G, B) ──► Linearization ──► Luminance Y ──► Toe Soft Clamping ──► Lightness Contrast Lc
```

---

## 2. Mathematical Transformations

### 1. sRGB to Relative Luminance ($Y$)

$$Y = 0.2126729 \cdot R_{\text{lin}} + 0.7151522 \cdot G_{\text{lin}} + 0.0721750 \cdot B_{\text{lin}}$$

### 2. Toe Soft Clamping ($Y_{\text{toe}}$)

$$Y_{\text{toe}} = \begin{cases} Y & Y > 0.022 \\ Y + (0.022 - Y)^{1.414} & Y \le 0.022 \end{cases}$$

### 3. Lightness Contrast ($L_c$)

For Dark Text on Light Background ($Y_{\text{bg}} > Y_{\text{txt}}$):
$$L_c = (Y_{\text{bg}}^{0.56} - Y_{\text{txt}}^{0.62}) \cdot 1.1414$$

For Light Text on Dark Background ($Y_{\text{bg}} \le Y_{\text{txt}}$):
$$L_c = (Y_{\text{bg}}^{0.65} - Y_{\text{txt}}^{0.57}) \cdot 1.1414$$

---

[⏮️ Previous: 09-02 Anti-Mock PNG IHDR Binary Inspection](09-02-anti-mock-png-ihdr-binary-inspection.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 09-04 Gate Prove & Terminal Run Sealing](09-04-gate-prove-and-terminal-completion.md)
---
