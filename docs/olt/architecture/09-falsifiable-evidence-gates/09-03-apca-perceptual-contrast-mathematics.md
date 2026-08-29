# APCA Perceptual Contrast Mathematics & WCAG 3.0 Engine

---

[Previous: 09-02 Anti-Mock Binary Inspection](09-02-anti-mock-png-ihdr-binary-inspection.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 09-04 Gate Prove & Terminal Completion](09-04-gate-prove-and-terminal-completion.md)
---

## 1. Executive Summary & The Visual Accessibility Imperative

In user interface and documentation design, simple mathematical contrast ratios (such as WCAG 2.1's legacy $(L_1 + 0.05)/(L_2 + 0.05)$) fail to account for the non-linear human visual perception of luminance. Legacy formulas frequently approve unreadable text combinations (e.g. thin orange text on dark backgrounds) while falsely rejecting accessible high-contrast combinations.

The **OLT (Orchestrating Long Tasks)** engine implements the **Advanced Perceptual Contrast Algorithm (APCA)** based on the **WCAG 3.0 Accessible Perceptual Contrast Model**. Under this system:

1. **Human Visual Luminance Modeling**: Relative luminance is calculated using non-linear gamma-corrected color transfer functions that model human cone sensitivity.
2. **Light-on-Dark vs. Dark-on-Light Asymmetry**: APCA applies asymmetric soft-clipping power transformations to calculate the perceptual lightness contrast $L_c$.
3. **Class 4 Verification Invariant**: Any generated UI component, documentation theme, or HTML report must achieve $L_c \ge 60$ for body text and $L_c \ge 75$ for fine print/code blocks.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 APCA PERCEPTUAL CONTRAST MODEL                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   RGB Text & Background Colors  ──► sRGB to Linear Luminance (Y_text, Y_bg)                      │
│                                           │                                                      │
│                                           ▼                                                      │
│                                   Soft-Clipping Power Curves (0.56 Exponent)                     │
│                                           │                                                      │
│                                           ▼                                                      │
│   Asymmetric APCA Formula       ──► Lightness Contrast: L_c = (Y_txt^0.56 - Y_bg^0.56) * 1.14    │
│                                           │                                                      │
│                                           ▼                                                      │
│   WCAG 3.0 Thresholds           ──► Body Text: L_c >= 60.0  |  Fine Code: L_c >= 75.0            │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Mathematical Specification of the APCA Model

### Step 1: sRGB to Linear Relative Luminance ($Y$)

Given 8-bit sRGB color channels $R, G, B \in [0, 255]$, normalize each channel to $[0.0, 1.0]$:

$$r = \left(\frac{R}{255}\right)^{2.4}, \quad g = \left(\frac{G}{255}\right)^{2.4}, \quad b = \left(\frac{B}{255}\right)^{2.4}$$

The linear relative luminance $Y$ is:

$$Y = 0.2126729 \cdot r + 0.7151522 \cdot g + 0.0721750 \cdot b$$

### Step 2: Soft-Clipping Power Transformations

To model human visual adaptation to ambient flare and dark adaptation:

$$Y_{\text{txt}} = \begin{cases} Y_{\text{text}}^{0.56} & \text{if } Y_{\text{text}} > 0.0005 \\ Y_{\text{text}} + (0.0005 - Y_{\text{text}})^{1.414} & \text{otherwise} \end{cases}$$

$$Y_{\text{bg}} = \begin{cases} Y_{\text{background}}^{0.56} & \text{if } Y_{\text{background}} > 0.0005 \\ Y_{\text{background}} + (0.0005 - Y_{\text{background}})^{1.414} & \text{otherwise} \end{cases}$$

### Step 3: Contrast Calculation ($L_c$)

```text
┌────────────────────────────────────────┬─────────────────────────────────────────────────────────┐
│ Polarity Case                          │ APCA Lightness Contrast Equation ($L_c$)                │
├────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
│ Dark Text on Light BG ($Y_{\text{bg}} > Y_{\text{txt}}$) │ $L_c = \big( Y_{\text{bg}}^{0.56} - Y_{\text{txt}}^{0.56} \big) \times 1.14 \times 100$        │
├────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
│ Light Text on Dark BG ($Y_{\text{bg}} \le Y_{\text{txt}}$)│ $L_c = \big( Y_{\text{bg}}^{0.62} - Y_{\text{txt}}^{0.62} \big) \times 1.14 \times 100$        │
└────────────────────────────────────────┴─────────────────────────────────────────────────────────┘
```

```mermaid
flowchart TD
    RGB[Input Text & BG sRGB Hex Codes] --> Normalize[Normalize channels to 0.0..1.0 with 2.4 gamma]
    Normalize --> LinearLuma[Compute Relative Luminance Y = 0.2126R + 0.7151G + 0.0721B]
    LinearLuma --> SoftClip[Apply 0.56 Soft-Clipping Adaptation Curve]
    SoftClip --> CheckPolarity{Is Y_bg > Y_txt (Dark on Light)?}

    CheckPolarity -->|Yes| DarkOnLight[L_c = (Y_bg^0.56 - Y_txt^0.56) * 1.14 * 100]
    CheckPolarity -->|No| LightOnDark[L_c = (Y_bg^0.62 - Y_txt^0.62) * 1.14 * 100]

    DarkOnLight --> EvaluateThreshold[Evaluate |L_c| >= 60.0]
    LightOnDark --> EvaluateThreshold

    EvaluateThreshold -->|Pass| PassProof([Class 4 Perceptual Proof Validated])
    EvaluateThreshold -->|Fail| FailProof[TRAP: INSUFFICIENT_PERCEPTUAL_CONTRAST]
```

---

## 3. WCAG 3.0 Compliance Scorecard

```text
┌───────────────────────────┬───────────────────┬──────────────────────────────────────────────────┐
│ UI Element Type           │ Minimum $|L_c|$   │ Application in OLT Ecosystem                     │
├───────────────────────────┼───────────────────┼──────────────────────────────────────────────────┤
│ Large Headings (≥ 24px)   │ $|L_c| \ge 45.0$  │ Chapter Index titles and section banners         │
├───────────────────────────┼───────────────────┼──────────────────────────────────────────────────┤
│ Standard Body Prose       │ $|L_c| \ge 60.0$  │ Technical paragraphs, descriptions, alerts       │
├───────────────────────────┼───────────────────┼──────────────────────────────────────────────────┤
│ Fine Code & Line Numbers  │ $|L_c| \ge 75.0$  │ Code blocks, ASCII diagrams, table borders       │
├───────────────────────────┼───────────────────┼──────────────────────────────────────────────────┤
│ Critical Alerts & Errors  │ $|L_c| \ge 90.0$  │ Security traps, fatal diagnostic warnings        │
└───────────────────────────┴───────────────────┴──────────────────────────────────────────────────┘
```

---

## 4. APCA Engine Implementation

The APCA calculator ([`apca-engine.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/reporting/theme/terminal-theme.ts)) computes contrast scores during documentation rendering and theme generation:

```typescript
export function computeAPCAContrast(textColorHex: string, bgColorHex: string): number {
  const yText = sRGBtoY(textColorHex);
  const yBg = sRGBtoY(bgColorHex);
  return calculateAPCA(yText, yBg);
}
```

---

## 5. Architectural Invariants Summary

1. **Perceptual Realism**: Contrast calculations adhere to non-linear human eye response models.
2. **Accessibility Floor**: Documentation themes must maintain $|L_c| \ge 60.0$ for all body text.
3. **Class 4 Verification**: UI components failing APCA thresholds are rejected fail-closed.

---

[Previous: 09-02 Anti-Mock Binary Inspection](09-02-anti-mock-png-ihdr-binary-inspection.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 09-04 Gate Prove & Terminal Completion](09-04-gate-prove-and-terminal-completion.md)
---
