# APCA Contrast Mathematics: Perceptual Lightness Contrast & W3C Silver Foundations

> **Status**: Authoritative Architecture Specification  
> **Topic**: Accessible Perceptual Contrast Algorithm (APCA), Photopic Luminance, Polarity Asymmetry, and UI Mechanical Validation  
> **Audience**: UI/UX Mechanical Validators, Design System Engineers, Front-End Architects

---

## 1. Executive Summary & Conceptual Overview

Legacy web accessibility standards (such as WCAG 2.x) compute contrast using a simple linear ratio of relative luminances:
$$\text{CR}_{\text{WCAG 2}} = \frac{L_1 + 0.05}{L_2 + 0.05}$$

While mathematically straightforward, the WCAG 2.x formula is deeply flawed when evaluated against human visual perception:

1. **Symmetric Blindness**: It treats light-on-dark and dark-on-light contrast identically, ignoring that human spatial vision has vastly different sensitivity depending on background polarity (the Helmholtz-Kohlrausch effect and spatial frequency adaptation).
2. **Spatial Frequency Ignorance**: It fails to account for font weight (stroke width) and font size. A thin 300-weight 12px font requires dramatically higher contrast to be legible than a bold 800-weight 36px heading.
3. **Mid-Tone Distortion**: It over-reports contrast for saturated blues and under-reports contrast for light oranges and greens.

The **Accessible Perceptual Contrast Algorithm (APCA)**—developed as the perceptual contrast candidate for **W3C Silver / WCAG 3**—models human visual psychophysics through nonlinear luminance curves, soft black flare compensation, power-law exponents for polarity asymmetry, and spatial frequency thresholds.

In the OLT runtime, UI mechanical validation engines (`apca.ts`, `glass-surfaces.ts`) execute APCA mathematical analysis on live DOM physics snapshots to enforce objective, perceptual readability guarantees.

```
       [Raw CSS Foreground / Background Colors]
                         │
                         ▼
        ┌─────────────────────────────────┐
        │  Linearize sRGB Channels        │
        │  $C_{lin} = (C / 255)^{2.4}$    │
        └─────────────────────────────────┘
                         │
                         ▼
        ┌─────────────────────────────────┐
        │  Compute Photopic Luminance (Y) │
        │  CIE 1931 Spectral Weighting    │
        └─────────────────────────────────┘
                         │
                         ▼
        ┌─────────────────────────────────┐
        │  Soft Black Flare Compensation  │
        │  Clamp Threshold $Y < 0.022$    │
        └─────────────────────────────────┘
                         │
                         ▼
        ┌─────────────────────────────────┐
        │  Polarity Asymmetry Power Curve │
        │  Light vs Dark Backgrounds      │
        └─────────────────────────────────┘
                         │
                         ▼
        ┌─────────────────────────────────┐
        │  Spatial Frequency Validation   │
        │  Font Size & Weight Compliance  │
        └─────────────────────────────────┘
                         │
                         ▼
        [Perceived Lightness Contrast Lc]
```

---

## 2. Complete Mathematical Formulation

The APCA calculation converts raw RGB color values to an absolute or signed **Lightness Contrast ($L_c$)** value between $0$ and $\pm 108$.

### 2.1 Color Channel Linearization (sRGB $\to$ Linear RGB)

Human vision perceives light logarithmically, while standard digital color spaces (sRGB) apply a gamma curve. First, the 8-bit integer RGB components ($R, G, B \in [0, 255]$) are normalized and linearized using the standard sRGB power curve exponent ($\gamma = 2.4$):

$$R_{\text{lin}} = \left(\frac{R}{255}\right)^{2.4}, \quad G_{\text{lin}} = \left(\frac{G}{255}\right)^{2.4}, \quad B_{\text{lin}} = \left(\frac{B}{255}\right)^{2.4}$$

---

### 2.2 Spectral Photopic Luminance ($Y$)

Linearized RGB channels are mapped to relative photopic luminance $Y \in [0.0, 1.0]$ using standard CIE 1931 spectral coefficients corresponding to the human eye's peak sensitivity to green wavelengths:

$$Y = 0.2126729 \cdot R_{\text{lin}} + 0.7151522 \cdot G_{\text{lin}} + 0.0721750 \cdot B_{\text{lin}}$$

Let $Y_{\text{txt}}$ be the relative luminance of the foreground text, and $Y_{\text{bg}}$ be the relative luminance of the background.

---

### 2.3 Soft Black Flare Compensation (Toe Clipping)

In low-luminance regions, stray light within the human ocular system (retinal flare) and display black-level lift prevent absolute black from reaching true zero perception. If either luminance is below the threshold $Y_{\text{thresh}} = 0.022$, soft clamping is applied:

$$\text{If } Y < 0.022 \implies Y \leftarrow Y + (0.022 - Y)^{1.414}$$

This transformation prevents division-by-zero anomalies and accurately mirrors the Weber-Fechner law at near-black thresholds.

---

### 2.4 Polarity Asymmetry & Power Law Scaling

Human contrast sensitivity exhibits severe asymmetry: dark text on a light background (positive polarity) activates different neural pathways and spatial integration than light text on a dark background (negative polarity).

APCA models this via asymmetric power exponents:

```
                  Lightness Contrast Curve (Lc)
   Lc
   ^
   │               Positive Polarity (Dark text on Light bg)
   │               Exponent: Y_bg^0.56 - Y_txt^0.57
   │
   ├─────────────────────────────── (Lc = 0 Neutral Threshold)
   │
   │               Negative Polarity (Light text on Dark bg)
   │               Exponent: Y_bg^0.65 - Y_txt^0.62
   v
```

#### Case A: Light Background ($Y_{\text{bg}} > Y_{\text{txt}}$ — Dark text on light background)

$$C_{\text{raw}} = \left(Y_{\text{bg}}^{0.56} - Y_{\text{txt}}^{0.57}\right) \times 1.14$$

#### Case B: Dark Background ($Y_{\text{bg}} \le Y_{\text{txt}}$ — Light text on dark background)

$$C_{\text{raw}} = \left(Y_{\text{bg}}^{0.65} - Y_{\text{txt}}^{0.62}\right) \times 1.14$$

where $1.14$ is the empirical scale factor fitting the psychophysical data.

---

### 2.5 Low-Contrast Noise Floor & Offset Scaling

To eliminate sub-threshold perceptual noise, differences below $|C_{\text{raw}}| < 0.1$ are clamped to zero. The resulting contrast is scaled by 100 with an offset subtraction ($\delta = 0.027$):

$$ L_c = \begin{cases}
0.0 & \text{if } |C_{\text{raw}}| < 0.1 \\
(C_{\text{raw}} - 0.027) \times 100 & \text{if } C_{\text{raw}} > 0 \quad (\text{Dark text on light}) \\
(C_{\text{raw}} + 0.027) \times 100 & \text{if } C_{\text{raw}} < 0 \quad (\text{Light text on dark})
\end{cases}$$

The resulting $L_c$ is a signed score where positive indicates dark-on-light, and negative indicates light-on-dark. The absolute magnitude $|L_c|$ indicates readable perceptual contrast.

---

## 3. Reference Implementation (`apca.ts`)

```typescript
export interface ParsedRGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export function sRgbToY(color: ParsedRGB): number {
  const rLin = Math.pow(color.r / 255, 2.4);
  const gLin = Math.pow(color.g / 255, 2.4);
  const bLin = Math.pow(color.b / 255, 2.4);
  return 0.2126729 * rLin + 0.7151522 * gLin + 0.072175 * bLin;
}

export function calculateApcaLightness(textColor: ParsedRGB, bgColor: ParsedRGB): number {
  let yTxt = sRgbToY(textColor);
  let yBg = sRgbToY(bgColor);

  const blackThresh = 0.022;
  const expBlack = 1.414;

  if (yTxt < blackThresh) {
    yTxt += Math.pow(blackThresh - yTxt, expBlack);
  }
  if (yBg < blackThresh) {
    yBg += Math.pow(blackThresh - yBg, expBlack);
  }

  const scaleFactor = 1.14;
  let contrast = 0;

  if (yBg > yTxt) {
    const yBgExp = Math.pow(yBg, 0.56);
    const yTxtExp = Math.pow(yTxt, 0.57);
    contrast = (yBgExp - yTxtExp) * scaleFactor;
  } else {
    const yBgExp = Math.pow(yBg, 0.65);
    const yTxtExp = Math.pow(yTxt, 0.62);
    contrast = (yBgExp - yTxtExp) * scaleFactor;
  }

  if (Math.abs(contrast) < 0.1) return 0;
  return contrast > 0 ? (contrast - 0.027) * 100 : (contrast + 0.027) * 100;
}
```

---

## 4. Spatial Frequency Thresholds in UI Validation

Perceptual contrast requirements depend directly on typography geometry (font size and stroke weight). The OLT Mechanical Validator enforces strict minimum $|L_c|$ thresholds based on DOM physics measurements:

| Typography Role | Font Size ($px$) | Weight ($w$) | Min Required $|L_c|$ | Severity If Violated |
| :--- | :--- | :--- | :--- | :--- |
| **Sub-body / Small Text** | $< 16\text{px}$ | $< 700$ | **$|L_c| \ge 90$** | Critical |
| **Standard Body Text** | $16\text{px} - 23\text{px}$ | $400 - 600$ | **$|L_c| \ge 75$** | Serious |
| **Large Body / Subheadings** | $\ge 18\text{px}$ bold or $\ge 24\text{px}$ reg | $\ge 700$ or $\ge 400$ | **$|L_c| \ge 60$** | Serious |
| **Display Headlines** | $\ge 36\text{px}$ bold | $\ge 700$ | **$|L_c| \ge 45$** | Moderate |
| **Non-Text / UI Badges** | Interactive Icons / Borders | Any | **$|L_c| \ge 45$** | Serious |
| **Sub-Threshold (Unreadable)** | Any text | Any | **$|L_c| < 45$** | **CRITICAL FAILURE** |

```typescript
export function getRequiredLc(fontSize: number, fontWeight: number): number {
  const isBold = fontWeight >= 700;
  if (fontSize >= 24 || (fontSize >= 18 && isBold)) {
    return 60;
  }
  if (fontSize >= 16) {
    return 75;
  }
  return 90;
}
```

---

## 5. Multi-Substrate Translucent & Glass Surface Validation

Modern user interfaces frequently employ frosted glass, blurred overlays (`backdrop-filter: blur()`), and translucent layers. A text element that appears readable against a dark wallpaper may become completely illegible when scrolled over a bright modal or light card.

OLT implements **Worst-Case Substrate Projection** (`glass-surfaces.ts`).

### 5.1 Alpha Compositing Formulation

Given a translucent foreground color $C_{\text{fg}}$ with alpha $\alpha \in [0, 1]$ atop a substrate $C_{\text{sub}}$:

$$C_{\text{comp}} = \alpha C_{\text{fg}} + (1 - \alpha) C_{\text{sub}}$$

### 5.2 Worst-Case Dynamic Substrate Verification

The validator evaluates the text element against extreme ambient substrate bounds:
1. $S_{\text{dark}} = \text{RGB}(0, 0, 0)$ (Pure Black Substrate)
2. $S_{\text{light}} = \text{RGB}(255, 255, 255)$ (Pure White Substrate)

```mermaid
flowchart TD
    A[Translucent Glass Container<br>rgba(255, 255, 255, 0.2)] --> B[Child Text Element: #FFFFFF]
    B --> C1[Composite over Pure Black: rgba 0,0,0,1]
    B --> C2[Composite over Pure White: rgba 255,255,255,1]
    C1 --> D1[Compute Lc_black = 82.4 -> PASS]
    C2 --> D2[Compute Lc_white = 14.1 -> CRITICAL FAIL]
    D2 --> E[Reject Glass Surface: Inadequate Minimum Contrast across Substrate Space]
```

$$\text{Glass Compliance Condition: } \min\left(|L_c(S_{\text{dark}})|, \, |L_c(S_{\text{light}})|\right) \ge L_{c,\text{required}}$$

---

## 6. CLI Invocations & Verification Commands

### Auditing UI Perceptual Contrast Matrix
```bash
bun olt/scripts/harness.ts defect:audit --apca
```

#### Sample Output
```text
#### APCA Perceptual Contrast Matrix
| State / Severity | Badge Text   | Foreground | Background | Perceived Lc | APCA Status |
| :--------------- | :----------- | :--------- | :--------- | :----------- | :---------- |
| PASS (Body)      | "Connected"  | #FFFFFF    | #1E293B    | Lc = -86.4   | COMPLIANT   |
| PASS (Headline)  | "Topology"   | #0F172A    | #F8FAFC    | Lc = +84.2   | COMPLIANT   |
| FAIL (Warning)   | "Degraded"   | #FBBF24    | #FFFFFF    | Lc = +22.1   | CRITICAL    |

- APCA Perceived Contrast Compliance: FAIL (Min Lc=22.1 < Required Lc=75.0)
```

---

## 7. Summary of Core Invariants

> [!IMPORTANT]
> 1. **Perceptual Metric Authority**: Contrast compliance in OLT is governed exclusively by APCA $L_c$, not legacy WCAG 2.x ratios.
> 2. **Font Geometry Thresholds**: Body text ($\ge 16\text{px}$) requires $|L_c| \ge 75$; small text ($< 16\text{px}$) requires $|L_c| \ge 90$.
> 3. **Sub-45 Hard Ban**: Any text rendered below $|L_c| < 45$ triggers an automatic `CRITICAL` mechanical defect.
> 4. **Multi-Substrate Invariant**: Translucent glass layers must satisfy required $L_c$ thresholds across both extreme black and white backdrops.
$$
