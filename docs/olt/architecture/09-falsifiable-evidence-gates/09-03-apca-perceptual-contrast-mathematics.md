# 09-03 APCA Perceptual Contrast Mathematics & WCAG 3.0 Engine

---

[Previous: 09-02 Anti-Mock PNG IHDR Binary Inspection](09-02-anti-mock-png-ihdr-binary-inspection.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 09-04 Gate Prove & Terminal Completion](09-04-gate-prove-and-terminal-completion.md)

---

## 1. Executive Summary & Epistemic Foundations

In graphical user interfaces, terminal dashboards, and technical documentation systems, visual readability cannot be adequately evaluated using legacy mathematical contrast ratios. The WCAG 2.1 ratio formula:

$$\text{Contrast}_{\text{WCAG 2.1}} = \frac{L_1 + 0.05}{L_2 + 0.05}$$

relies on an oversimplified linear ratio of luminance that fails to model the human visual system's non-linear perception of lightness, spatial frequency, and dark-adaptation flare. As a consequence, legacy algorithms systematically approve visually illegible color pairs (such as thin saturated orange text on pure black backgrounds) while rejecting highly legible, accessible color combinations on light backgrounds.

The **OLT (Orchestrating Long Tasks)** engine implements the **Advanced Perceptual Contrast Algorithm (APCA)** based on the **WCAG 3.0 Accessible Perceptual Contrast Model**. The APCA subsystem provides mathematically rigorous, perception-based contrast certification for all generated user interfaces, CLI color schemes, and documentation themes.

```text
+--------------------------------------------------------------------------------------------------+
│                             APCA PERCEPTUAL CONTRAST ENGINE TOPOLOGY                             │
+--------------------------------------------------------------------------------------------------+
│                                                                                                  │
│   RGB HEX COLORS: Text Color (#E0E0E0) & Background Color (#121212)                              │
│        │                                                                                         │
│        ▼ (Step 1: Gamma Un-companding / Linearization)                                           │
│   +------------------------------------------------------------------------------------------+   │
│   │                              sRGB TO LINEAR RGB CONVERSION                               │   │
│   │  - Un-compand 8-bit channels: r = (R/255)^2.4, g = (G/255)^2.4, b = (B/255)^2.4          │   │
│   │  - Apply CIE 1931 standard luminance weights: Y = 0.21267*r + 0.71515*g + 0.07218*b      │   │
│   +---------------------------------------------+--------------------------------------------+   │
│                                                 │                                                │
│                                                 ▼ (Step 2: Soft-Clipping Flare Adaptation)       │
│   +------------------------------------------------------------------------------------------+   │
│   │                              CORNEA FLARE & BLACK LEVEL CLIPPING                         │   │
│   │  - Adjust for low-luminance ambient flare: Y_adj = Y > 0.0005 ? Y^0.56 : Y + (0.0005-Y)^1.4│ │
│   +---------------------------------------------+--------------------------------------------+   │
│                                                 │                                                │
│                                                 ▼ (Step 3: Asymmetric Lightness Contrast L_c)   │
│   +------------------------------------------------------------------------------------------+   │
│   │                              ASYMMETRIC POLARITY CALCULATION                             │   │
│   │  - Dark Text on Light BG:  L_c = (Y_bg^0.56 - Y_txt^0.56) * 1.14 * 100                   │   │
│   │  - Light Text on Dark BG:  L_c = (Y_bg^0.62 - Y_txt^0.62) * 1.14 * 100                   │   │
│   +---------------------------------------------+--------------------------------------------+   │
│                                                 │                                                │
│                                                 ▼ (Step 4: Class 4 Acceptance Certification)     │
│   +------------------------------------------------------------------------------------------+   │
│   │                              WCAG 3.0 ACCESSIBILITY SCORECARD                            │   │
│   │  - Body Prose Standard:    |L_c| >= 60.0                                                 │   │
│   │  - Code Blocks & Tables:   |L_c| >= 75.0                                                 │   │
│   │  - Critical Traps/Alerts:  |L_c| >= 90.0                                                 │   │
│   +------------------------------------------------------------------------------------------+   │
│                                                                                                  │
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Core Architectural Principles & Invariants

1. **Perceptual Non-Linearity Invariant**: Relative luminance must always be computed using non-linear gamma-corrected exponential functions modeling human cone spectral sensitivity rather than linear Euclidean color distance.
2. **Polarity Asymmetry Principle**: The human visual system processes light text on a dark background differently than dark text on a light background due to intraocular light scattering (haloing). APCA mathematically differentiates these cases using asymmetric exponents ($0.56$ vs $0.62$).
3. **Class 4 Verification Invariant**: Any UI view, terminal color map, or generated documentation stylesheet must satisfy $|L_c| \ge 60.0$ for regular body text and $|L_c| \ge 75.0$ for monospace code blocks and data tables.
4. **Zero Flawed Legacy Formulas**: The engine explicitly prohibits the use of legacy WCAG 2.1 ratio formulas ($4.5:1$ thresholds) across all validation checks.

```text
+--------------------------------------------------------------------------------------------------+
│                             APCA SCORECARD THRESHOLD MATRIX                                      │
+-------------------------+-------------------+--------------------+-------------------------------+
│ Content Element Type    │ Minimum Score L_c │ Font Sizing Bound  │ Typical OLT Target Element    │
+-------------------------+-------------------+--------------------+-------------------------------+
│ Large Headings (H1/H2)  │ |L_c| >= 45.0     │ >= 24px Bold       │ Chapter Title Banners         │
+-------------------------+-------------------+--------------------+-------------------------------+
│ Standard Body Prose     │ |L_c| >= 60.0     │ 14px - 18px Regular│ Technical Explanations, Guides│
+-------------------------+-------------------+--------------------+-------------------------------+
│ Fine Monospace Code     │ |L_c| >= 75.0     │ 12px - 14px Mono   │ Code Snippets, ASCII Schemas  │
+-------------------------+-------------------+--------------------+-------------------------------+
│ Fatal Alerts & Warnings │ |L_c| >= 90.0     │ Any Size           │ Security Traps, Failure Logs  │
+-------------------------+-------------------+--------------------+-------------------------------+
```

---

## 3. Algorithmic Mechanics & State Transitions

The APCA calculation engine transforms hex color strings into verifiable perceptual lightness contrast scores through a deterministic 5-stage pipeline:

```mermaid
flowchart TD
    Input[Input sRGB Color Pair: textHex, bgHex] --> ParseHex[Parse 8-bit R, G, B Integer Channels]
    ParseHex --> Linearize[Apply 2.4 Gamma Un-companding to [0.0..1.0]]
    Linearize --> CalcLuminance[Compute Linear Luminance Y via CIE 1931 Coefficients]

    CalcLuminance --> SoftClip[Apply Flare Soft-Clipping Power Transforms: Y_txt, Y_bg]
    SoftClip --> PolarityCheck{Is Y_bg > Y_txt? Dark on Light}

    PolarityCheck -->|Yes: Dark on Light| CalcDarkOnLight[L_c = (Y_bg^0.56 - Y_txt^0.56) * 1.14 * 100]
    PolarityCheck -->|No: Light on Dark| CalcLightOnDark[L_c = (Y_bg^0.62 - Y_txt^0.62) * 1.14 * 100]

    CalcDarkOnLight --> AbsScore[Calculate Absolute Contrast |L_c|]
    CalcLightOnDark --> AbsScore

    AbsScore --> GateCheck{Is |L_c| >= Target Threshold?}
    GateCheck -->|Yes: Score Satisfied| IssueReceipt[Generate Class 4 ApcaContrastReceipt]
    GateCheck -->|No: Contrast Insufficient| RejectGate[TRAP: INSUFFICIENT_PERCEPTUAL_CONTRAST]

    IssueReceipt --> Pass([Class 4 Proof Sealed])
    RejectGate --> Repair[Route to Palette Repair Playbook]
```

---

## 4. Mathematical Formulations & Proofs

### 1. sRGB Channel Linearization

Given 8-bit sRGB color channels $R, G, B \in [0, 255]$, the linearized color channels $r, g, b \in [0.0, 1.0]$ are calculated using an exponential gamma approximation:

$$r = \left(\frac{R}{255}\right)^{2.4}, \quad g = \left(\frac{G}{255}\right)^{2.4}, \quad b = \left(\frac{B}{255}\right)^{2.4}$$

### 2. Spectral Relative Luminance ($Y$)

Linear relative luminance $Y$ is computed using the CIE 1931 standard luminous efficiency coefficients:

$$Y = 0.2126729 \cdot r + 0.7151522 \cdot g + 0.0721750 \cdot b$$

### 3. Flare Soft-Clipping Adaptation

To compensate for dark-room corneal flare and display backlight leakage, the soft-clipping operator $\mathcal{S}(Y)$ is applied:

$$ \mathcal{S}(Y) = \begin{cases}
Y^{0.56} & \text{if } Y > 0.0005 \\
Y + (0.0005 - Y)^{1.414} & \text{if } Y \le 0.0005
\end{cases}$$

Let $Y_{\text{txt\_clip}} = \mathcal{S}(Y_{\text{txt}})$ and $Y_{\text{bg\_clip}} = \mathcal{S}(Y_{\text{bg}})$.

### 4. Asymmetric Lightness Contrast Formulation ($L_c$)

The APCA Lightness Contrast $L_c$ is calculated asymmetrically based on polarity:

$$L_c = \begin{cases}
\big( Y_{\text{bg\_clip}}^{0.56} - Y_{\text{txt\_clip}}^{0.56} \big) \times 1.14 \times 100 & \text{if } Y_{\text{bg}} > Y_{\text{txt}} \quad (\text{Dark on Light}) \\
\big( Y_{\text{bg\_clip}}^{0.62} - Y_{\text{txt\_clip}}^{0.62} \big) \times 1.14 \times 100 & \text{if } Y_{\text{bg}} \le Y_{\text{txt}} \quad (\text{Light on Dark})
\end{cases}$$

### 5. Proof of Failure in WCAG 2.1 for Dark Themes

Consider a dark UI with background $B = \#121212$ ($Y_B \approx 0.004$) and saturated orange text $T = \#FF5500$ ($Y_T \approx 0.245$).

Under legacy WCAG 2.1:

$$\text{Ratio}_{\text{legacy}} = \frac{0.245 + 0.05}{0.004 + 0.05} = \frac{0.295}{0.054} \approx 5.46:1$$

Legacy WCAG 2.1 issues a **PASS** because $5.46:1 \ge 4.5:1$. However, under APCA:

$$Y_{\text{bg\_clip}} = (0.004)^{0.62} \approx 0.032, \quad Y_{\text{txt\_clip}} = (0.245)^{0.62} \approx 0.419$$

$$L_c = (0.032 - 0.419) \times 1.14 \times 100 = -0.387 \times 114 \approx -44.1$$

Since $|L_c| = 44.1 < 60.0$, APCA accurately **REJECTS** the combination as unreadable body text, demonstrating mathematical superiority over legacy standards.

---

## 5. Concrete TypeScript Contracts & Schemas

The APCA contrast evaluation contract is defined in [`apca.ts`](../../../../olt/scripts/src/cli/commands/defect-audit/apca.ts).

```typescript
export interface RgbTuple {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export type ApcaElementType = "HEADING" | "BODY_PROSE" | "CODE_BLOCK" | "FATAL_ALERT";

export interface ApcaEvaluationRequest {
  readonly textColorHex: string;
  readonly backgroundColorHex: string;
  readonly targetElement: ApcaElementType;
}

export interface ApcaEvaluationResult {
  readonly textColorHex: string;
  readonly backgroundColorHex: string;
  readonly textLuminance: number;
  readonly bgLuminance: number;
  readonly calculatedLc: number;
  readonly absoluteLc: number;
  readonly thresholdRequired: number;
  readonly isAccessible: boolean;
  readonly polarity: "DARK_ON_LIGHT" | "LIGHT_ON_DARK";
}

export interface ApcaContrastReceipt {
  readonly schemaVersion: "2026-03";
  readonly componentPath: string;
  readonly evaluation: ApcaEvaluationResult;
  readonly certifiedAt: string;
  readonly sha256Digest: string;
}
```

```typescript
export function sRGBtoLinear(channel8Bit: number): number {
  const norm = channel8Bit / 255;
  return Math.pow(norm, 2.4);
}

export function calculateRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  const linR = sRGBtoLinear(r);
  const linG = sRGBtoLinear(g);
  const linB = sRGBtoLinear(b);

  return 0.2126729 * linR + 0.7151522 * linG + 0.072175 * linB;
}

export function evaluateAPCAContrast(
  textColorHex: string,
  bgColorHex: string,
  targetElement: ApcaElementType,
): ApcaEvaluationResult {
  const yTxt = calculateRelativeLuminance(textColorHex);
  const yBg = calculateRelativeLuminance(bgColorHex);

  const isDarkOnLight = yBg > yTxt;
  let lc: number;

  if (isDarkOnLight) {
    const yBgClip = yBg > 0.0005 ? Math.pow(yBg, 0.56) : yBg + Math.pow(0.0005 - yBg, 1.414);
    const yTxtClip = yTxt > 0.0005 ? Math.pow(yTxt, 0.56) : yTxt + Math.pow(0.0005 - yTxt, 1.414);
    lc = (yBgClip - yTxtClip) * 1.14 * 100;
  } else {
    const yBgClip = yBg > 0.0005 ? Math.pow(yBg, 0.62) : yBg + Math.pow(0.0005 - yBg, 1.414);
    const yTxtClip = yTxt > 0.0005 ? Math.pow(yTxt, 0.62) : yTxt + Math.pow(0.0005 - yTxt, 1.414);
    lc = (yBgClip - yTxtClip) * 1.14 * 100;
  }

  const absLc = Math.abs(lc);
  const threshold =
    targetElement === "HEADING"
      ? 45.0
      : targetElement === "BODY_PROSE"
        ? 60.0
        : targetElement === "CODE_BLOCK"
          ? 75.0
          : 90.0;

  return {
    textColorHex,
    backgroundColorHex,
    textLuminance: yTxt,
    bgLuminance: yBg,
    calculatedLc: lc,
    absoluteLc: absLc,
    thresholdRequired: threshold,
    isAccessible: absLc >= threshold,
    polarity: isDarkOnLight ? "DARK_ON_LIGHT" : "LIGHT_ON_DARK",
  };
}
```

---

## 6. Failure Modes, Anti-Blunders & Recovery Playbooks

```text
+--------------------------------------------------------------------------------------------------+
│                             APCA CONTRAST ANTI-BLUNDER MATRIX                                    │
+--------------------------+------------------------------+----------------------------------------+
│ Blunder Anti-Pattern     │ Root Cause                   │ OLT Prevention & Recovery Playbook     │
+--------------------------+------------------------------+----------------------------------------+
│ Dark-Mode Halation       │ Bright thin font on black    │ APCA applies 0.62 power curve;         │
│ Unreadability            │ background causes visual     │ requires thicker font stroke or adjusts│
│                          │ blooming in human eye.       │ text luminance down to prevent glare.  │
+--------------------------+------------------------------+----------------------------------------+
│ Low-Contrast Monospace   │ Subtle gray text on dark gray│ Class 4 strictly enforces |L_c| >= 75.0│
│ Syntax Highlighting      │ code backgrounds fails code  │ for code tokens; rejects theme changes │
│                          │ legibility standards.        │ until syntax palette is brightened.    │
+--------------------------+------------------------------+----------------------------------------+
│ Legacy WCAG 2.1 Ratio    │ Author relies on 4.5:1 ratio │ Static linter flags legacy contrast    │
│ Hallucination            │ that passes unreadable saturated calculations; requires invocation of  │
│                          │ colors on dark backgrounds.  │ calculateAPCA() engine.                │
+--------------------------+------------------------------+----------------------------------------+
│ Pure White/Pure Black    │ Excessive contrast (|L_c| >  │ Color tokenizer caps extreme contrast  │
│ Eyestrain Fatigue        │ 105) causes visual fatigue in│ for long-form reading by recommending  │
│                          │ long technical documentation.│ off-white text (#E0E0E0 on #121212).   │
+--------------------------+------------------------------+----------------------------------------+
```

---

## 7. Architectural Invariants Summary & Verification Checklist

1. **Perceptual Compliance**: Contrast verification must follow WCAG 3.0 APCA non-linear models.
2. **Body Text Standard**: All prose documentation and general UI strings must satisfy $|L_c| \ge 60.0$.
3. **Monospace Code Standard**: All code blocks, terminal outputs, and data tables must satisfy $|L_c| \ge 75.0$.
4. **Deterministic Calculation**: Pure TypeScript implementation guarantees cross-platform numerical parity.
5. **Class 4 Evidence Binding**: Documentation themes and UI components cannot be merged without a valid `ApcaContrastReceipt`.

---

[Previous: 09-02 Anti-Mock PNG IHDR Binary Inspection](09-02-anti-mock-png-ihdr-binary-inspection.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 09-04 Gate Prove & Terminal Completion](09-04-gate-prove-and-terminal-completion.md)

---
$$
