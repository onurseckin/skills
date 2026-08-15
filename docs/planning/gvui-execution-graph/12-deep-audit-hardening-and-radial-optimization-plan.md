# 12: Deep Audit Hardening & Radial Layout Engine Optimization Master Plan

## 1. Executive Summary & Architectural Overview

The GVUI layout engine suite delivers high-performance WebAssembly-compiled graph layout algorithms executing inside the browser client and regression audit runners. The suite comprises two core engines:
1. **Layered Engine (`layered`)**: Sugiyama-style hierarchical rank assignment with Brandes-Köpf coordinate calculation, in-layer badge slot reservation, and orthogonal rectilinear channel routing.
2. **Radial Engine (`radial`)**: Polar concentric ring BFS layout with proportional subtree angular wedge allocation and bowed chord routing.

### 1.1 The Quality Gap & Optimization Objective
Historically, the layout audit runner (`scripts/runLayoutAudit.ts`) maintained a split standard:
- **Layered Engine**: Strict zero-tolerance gate across all 7 geometric constraint metrics (`nodeNodeOverlaps`, `edgeNodePenetrations`, `badgeNodeOverlaps`, `badgeBadgeOverlaps`, `badgeEdgePenetrations`, `unresolvedRouteCount`, `unresolvedBadgeCount`).
- **Radial Engine**: Permitted 4 of the 7 metrics (`edgeNodePenetrations`, `badgeNodeOverlaps`, `badgeBadgeOverlaps`, `badgeEdgePenetrations`) as "unresolved soft conflicts", relying on straight-line spokes, naive 30% inward chords, and best-effort Cartesian badge placement that generated unwanted leader lines.
- **Direction Coverage**: Only 3 configurations were audited (`layered/top-down`, `layered/left-right`, `radial/top-down`), leaving inverted flow directions (`bottom-top`, `right-left`) and 75% of radial directions untested.

### 1.2 The Master Solution
This master plan synthesizes the architectural specifications designed in Modules 1 through 4 into an actionable implementation roadmap:
- **Exhaustive Matrix Expansion**: Expand audit suite to the complete $2 \times 4 \times 35 = 280$ test runs ($2\text{ engines} \times 4\text{ directions} \times 35\text{ fixtures}$).
- **Polar Corridor Detour Routing Algorithm (PCDRA)**: Implement concentric routing corridors ($R_{\text{corr}, k}$) and polar obstacle avoidance waypoints in the radial engine, eliminating all edge-node interior penetrations ($0$ penetrations).
- **Polar Sector Clearance Allocation (PSCA)**: Formalize angular sector reservations, ring circumference inflation, and parallel bundle radial staggering, eliminating all badge collisions and reducing leader lines to $\le 2$ total.
- **Layered Inverted Transforms Hardening**: Formalize and verify affine coordinate inversion transforms ($\mathcal{T}_{\text{BT}}, \mathcal{T}_{\text{LR}}, \mathcal{T}_{\text{RL}}$), port normal transformations, and channel lane depth invariants.
- **Zero-Tolerance Gate Unification**: Eliminate the split standard in `runLayoutAudit.ts` so that ALL 280 test configurations must satisfy strict $0$ collision invariants within a 250ms per-run performance budget.

---

## 2. Synthesis of Planning Specifications

```
+----------------------------------------------------------------------------------------------------+
|                               MASTER ARCHITECTURE & SPECIFICATION SYNTHESIS                       |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ Module 1: Audit Matrix & Failure Taxonomy ]                                                     |
|    - 280 Test Matrix: 2 Engines x 4 Directions x 35 Fixtures                                       |
|    - 26 Synthetic Stress Fixtures + 9 Real-World Telemetry Fixtures                                |
|    - Root Cause Analysis of 4 Radial Soft Warning Collision Classes                                |
|                                                                                                    |
|  [ Module 2: Radial Obstacle Detour Geometry (PCDRA) ]                                             |
|    - Dual Polar/Cartesian Coordinate Space Transformations                                         |
|    - Polar AABB Bounding Sectors: [theta_min, theta_max] x [r_min, r_max]                          |
|    - Concentric Inter-Ring Routing Corridors: R_corr,k = (R_k + R_{k+1}) / 2                       |
|    - Tangential Obstacle Detour Waypoint Generation: <p_src, p_entry, p_mid, p_exit, p_tgt>        |
|                                                                                                    |
|  [ Module 3: Radial Badge Clearance Allocation (PSCA) ]                                            |
|    - Polar Sector Reservations: Delta theta_b(R_b) = 2 arctan(sqrt(w_b^2 + h_b^2) / (2 R_b))       |
|    - Circumferential Arc Inflation during Ring Sizing: C_k = Sum(NodeArcs) + Sum(BadgeArcs)        |
|    - Polar Grid Candidate Probing & Multi-Edge Parallel Bundle Radial Staggering                   |
|                                                                                                    |
|  [ Module 4: Layered Inverted Transform Invariants ]                                               |
|    - Direction as Coordinate Frame: TD (Identity), BT (Vertical Mirror), LR (Transpose),          |
|      RL (Transpose + Horizontal Mirror)                                                            |
|    - Outward Port Normal Vector Invariance: v'_stub = L_stub * n(T(Side))                          |
|    - Channel Lane Depth Isometry & Collinear Edge Avoidance Invariance Proofs                      |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. Step-by-Step Implementation Roadmap

The implementation is structured into 6 sequential, deterministic phases:

### Phase 1: Test Runner Matrix Expansion (`scripts/runLayoutAudit.ts`)
1. **Expand `AUDIT_CASES`**:
   Replace the current 3-case array with all 8 engine/direction configurations:
   ```typescript
   const AUDIT_CASES: readonly AuditCase[] = [
     { mode: "layered", direction: "top-down", label: "layered/top-down" },
     { mode: "layered", direction: "bottom-top", label: "layered/bottom-top" },
     { mode: "layered", direction: "left-right", label: "layered/left-right" },
     { mode: "layered", direction: "right-left", label: "layered/right-left" },
     { mode: "radial", direction: "top-down", label: "radial/top-down" },
     { mode: "radial", direction: "bottom-top", label: "radial/bottom-top" },
     { mode: "radial", direction: "left-right", label: "radial/left-right" },
     { mode: "radial", direction: "right-left", label: "radial/right-left" },
   ];
   ```
2. **Matrix Test Runner Telemetry**:
   Update `runLayoutAudit.ts` reporting to summarize passes across all $8 \times 35 = 280$ runs with individual fixture run timers and memory counters.

### Phase 2: Polar Obstacle Detour Routing in Radial Engine (`crates/gvui/src/7_engines/7_3_radial.rs` & `7_2_geometric_common.rs`)
1. **Obstacle Detection Function**:
   Implement `detect_polar_obstacles(ir, rects, route_endpoints, epsilon)` using the `SpatialHash` index over positioned node boxes.
2. **Corridor Waypoint Generator**:
   Implement `build_radial_detour_route`:
   - Compute intermediate corridor radius $R_{\text{corr}} = \frac{R_u + R_v}{2}$ (or adjacent inter-ring corridor).
   - Calculate angular entry and exit bounds $\theta_{\text{entry}} = \theta_{\min} - \delta_\theta$ and $\theta_{\text{exit}} = \theta_{\max} + \delta_\theta$.
   - Generate arc waypoints $P_{\text{entry}}, P_{\text{mid}}, P_{\text{exit}}$ along $(R_{\text{corr}} a_x \cos\theta, R_{\text{corr}} a_y \sin\theta)$.
   - Clip boundary normals at source and target nodes with `clip_to_boundary`.
3. **Rust Unit Tests**:
   Add unit tests in `crates/gvui/src/7_engines/7_3_radial.rs` validating 0 obstacle collisions for deep chains and cross-cutting chords.

### Phase 3: Radial Badge Sector Clearance & Staggering (`crates/gvui/src/7_engines/7_3_radial.rs` & `7_2_geometric_common.rs`)
1. **Circumferential Arc Inflation in `ring_radii`**:
   Update `ring_radii` in `7_3_radial.rs` to compute total badge arc demand $\sum_{e \in \mathcal{E}_k} (w_{b,e} |\sin\theta_e| + h_{b,e} |\cos\theta_e| + \text{gap})$ and ensure $R_k \ge R_{\text{circ}, k}$.
2. **Polar Candidate Offsets**:
   Refactor `badge_offsets` in `7_2_geometric_common.rs` to generate candidates along polar arcs $(R \pm \Delta R, \theta \pm \Delta\theta)$.
3. **Radial Staggering for Bundles**:
   Implement radial bundle distribution $t_m = \frac{m+1}{M+1}$ for parallel multi-edges between identical node pairs.
4. **Rust Unit Tests**:
   Add unit tests in `crates/gvui/src/7_engines/7_2_geometric_common.rs` verifying 0 badge-node and 0 badge-badge overlaps on $K_5$ parallel edge bundles.

### Phase 4: Layered Inverted Transforms Hardening (`crates/gvui/src/7_engines/7_1_layered.rs`)
1. **Symmetry Assertion Tests**:
   Implement automated invariant checks in `7_1_layered.rs` asserting:
   - Node count, edge count, and badge count equivalence between TD and BT, and between LR and RL.
   - Exact aspect ratio reciprocal relationship: $\text{AR}_{\text{LR}} = 1 / \text{AR}_{\text{TD}}$.
   - Outward port normal vector alignment across all 4 directions.

### Phase 5: Zero-Tolerance Constraint Gate Unification (`scripts/runLayoutAudit.ts`)
1. **Unify `constraintFieldsFor`**:
   Remove the split engine exception in `runLayoutAudit.ts`:
   ```typescript
   function constraintFieldsFor(_auditCase: AuditCase): readonly (keyof AuditLayoutMetrics)[] {
     return [...UNIVERSAL_CONSTRAINT_FIELDS, ...LAYERED_ONLY_CONSTRAINT_FIELDS];
   }
   ```
2. **Leader Line Cap**:
   Enforce $\text{leaderCount} \le 2$ total across the entire 35-fixture suite.

### Phase 6: Performance Benchmarking & Full Regression Verification
1. **WASM Compilation**:
   Compile Rust crate to WASM package (`wasm-pack build --target web`).
2. **280-Run Gate Execution**:
   Run `bun scripts/runLayoutAudit.ts` ensuring:
   - Total Runs: 280
   - Total Failures: 0
   - Execution Time: $\le 250\text{ms}$ per run (Total suite execution $\le 3.5\text{s}$).

---

## 4. File Touchpoints & Component Map

| Component / Subsystem | Primary Source File | Responsibilities & Planned Modifications |
|---|---|---|
| **Audit Harness** | `scripts/runLayoutAudit.ts` | Expand `AUDIT_CASES` to 8 configurations (280 runs); unify `constraintFieldsFor` to zero-tolerance across all engines. |
| **Radial Engine** | `crates/gvui/src/7_engines/7_3_radial.rs` | Integrate PCDRA polar corridor routing; inflate `ring_radii` with composite badge arc demand; support 4 flow rotations. |
| **Geometric Helpers** | `crates/gvui/src/7_engines/7_2_geometric_common.rs` | Implement polar candidate offset generator; implement parallel bundle radial staggering; enforce corridor placement. |
| **Layered Engine** | `crates/gvui/src/7_engines/7_1_layered.rs` | Harden affine coordinate transforms ($\mathcal{T}_{\text{BT}}, \mathcal{T}_{\text{LR}}, \mathcal{T}_{\text{RL}}$); verify port stub normals. |
| **Constraint Scanner** | `crates/gvui/src/6_validation/6_1_constraints.rs` | Validate spatial index queries and strict collision assertions across all 280 wire payloads. |
| **TypeScript Adapter** | `src/engine/layout/customLayoutAdapter.ts` | Verify composite badge measurement propagation and wire result schema alignment. |

---

## 5. Test Assertions, Metrics & Acceptance Criteria

### 5.1 Formal Acceptance Criteria

$$\forall e \in \mathcal{E}, \forall d \in \mathcal{D}, \forall f \in \mathcal{F}:$$
1. **Zero Node Overlaps**: $\text{nodeNodeOverlaps}(e, d, f) = 0$
2. **Zero Route Penetrations**: $\text{edgeNodePenetrations}(e, d, f) = 0$
3. **Zero Badge-Node Overlaps**: $\text{badgeNodeOverlaps}(e, d, f) = 0$
4. **Zero Badge-Badge Overlaps**: $\text{badgeBadgeOverlaps}(e, d, f) = 0$
5. **Zero Badge-Edge Penetrations**: $\text{badgeEdgePenetrations}(e, d, f) = 0$
6. **Zero Unresolved Routes**: $\text{unresolvedRouteCount}(e, d, f) = 0$
7. **Zero Unresolved Badges**: $\text{unresolvedBadgeCount}(e, d, f) = 0$
8. **Bounded Leader Lines**: $\sum_{f \in \mathcal{F}} \text{leaderCount}(\text{radial}, d, f) \le 2$
9. **Strict Performance Budget**: $\text{durationMs}(e, d, f) \le 250.0\text{ms}$
10. **Global Audit Pass**: $\text{Failures} = 0 \text{ across all } 280 \text{ runs}$.

---

## 6. Risk Analysis & Mitigation Strategies

| Risk / Hazard | Impact | Mitigation Strategy |
|---|---|---|
| **Radial Ring Inflation Overhead** | Excessive radius growth inflating canvas bounds in dense graphs | Apply non-linear aspect ratio damping and clamp maximum corridor expansion to $1.5 \times \text{radial\_ring\_gap}$. |
| **High-Degree Polar Detour Complexity** | Polar detour arc subdivision causing bend count explosion in non-planar graphs | Restrict detour waypoint insertion to minimum necessary polygon segments ($3 \text{ to } 5 \text{ points}$ max per chord). |
| **WASM Execution Time Degradation** | Complex spatial queries slowing layout computation beyond 250ms budget | Utilize existing `SpatialHash` uniform grid indexing for all polar ray and corridor intersection tests. |
| **Collinear Detour Overlaps** | Multiple detour arcs sharing identical corridor radii merging visually | Stagger concentric corridor tracks via fractional radius offsets: $R_{\text{corr}} + \Delta r \cdot (i \pmod 3)$. |

---

## 7. Conclusion

By unifying the 8-direction audit matrix ($280$ runs), introducing the Polar Corridor Detour Routing Algorithm (PCDRA), deploying Polar Sector Clearance Allocation (PSCA), and formalizing layered inverted transform invariants, the GVUI layout engine achieves mathematical parity and strict zero-tolerance quality guarantees across both layered and radial layout paradigms.
