import { describe, expect, it } from "bun:test";
import * as domEventSim from "../../../../olt/scripts/src/capture/runners/dom-event-simulator/index.ts";
import * as layoutShiftTracker from "../../../../olt/scripts/src/capture/runners/layout-shift-tracker/index.ts";
import * as liveCaptureRunner from "../../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import * as runnersBarrel from "../../../../olt/scripts/src/capture/runners/index.ts";

describe("runners index barrel exports", () => {
  it("exports all expected symbols from dom-event-simulator", () => {
    expect(domEventSim.DOM_EVENT_DISPATCH_SCRIPT).toBeDefined();
    expect(domEventSim.DEFAULT_DOM_SIMULATION_OPTIONS).toBeDefined();
    expect(domEventSim.DomEventSimulator).toBeDefined();
    expect(domEventSim.buildSyntheticInteractionPlan).toBeDefined();
    expect(domEventSim.classifyLayoutShift).toBeDefined();
    expect(domEventSim.resolveDomSimulationOptions).toBeDefined();
    expect(domEventSim.simulateDomEvent).toBeDefined();
  });

  it("exports all expected symbols from layout-shift-tracker", () => {
    expect(layoutShiftTracker.DEFAULT_LAYOUT_SHIFT_OPTIONS).toBeDefined();
    expect(layoutShiftTracker.LayoutShiftTracker).toBeDefined();
    expect(layoutShiftTracker.buildCumulativeLayoutShiftReport).toBeDefined();
    expect(layoutShiftTracker.calculateDistanceFraction).toBeDefined();
    expect(layoutShiftTracker.calculateImpactFraction).toBeDefined();
    expect(layoutShiftTracker.calculateLayoutShiftScore).toBeDefined();
    expect(layoutShiftTracker.clipRectToViewport).toBeDefined();
    expect(layoutShiftTracker.computeRectanglesUnionArea).toBeDefined();
    expect(layoutShiftTracker.detectLayoutShiftBetweenSnapshots).toBeDefined();
    expect(layoutShiftTracker.groupSessionWindows).toBeDefined();
    expect(layoutShiftTracker.identifyRootCausingElements).toBeDefined();
    expect(layoutShiftTracker.resolveLayoutShiftTrackerOptions).toBeDefined();
  });

  it("exports all expected symbols from live-capture-runner", () => {
    expect(liveCaptureRunner.DefaultFallbackBrowserProvider).toBeDefined();
    expect(liveCaptureRunner.createSyntheticPngBuffer).toBeDefined();
    expect(liveCaptureRunner.filterScreens).toBeDefined();
    expect(liveCaptureRunner.resolveCaptureOutputDir).toBeDefined();
    expect(liveCaptureRunner.resolveViewportsForScreen).toBeDefined();
    expect(liveCaptureRunner.runLiveCapture).toBeDefined();
  });

  it("exports all symbols through root runners barrel", () => {
    expect(runnersBarrel.PNG_SIGNATURE).toBeDefined();
    expect(runnersBarrel.extractPngDimensions).toBeDefined();
    expect(runnersBarrel.isPngBuffer).toBeDefined();
    expect(runnersBarrel.validatePngBuffer).toBeDefined();
    expect(runnersBarrel.CANONICAL_ROLES).toBeDefined();
    expect(runnersBarrel.SessionAuthResolver).toBeDefined();
    expect(runnersBarrel.createSessionAuthResolver).toBeDefined();
    expect(runnersBarrel.DOM_PHYSICS_EXTRACTION_SCRIPT).toBeDefined();
    expect(runnersBarrel.computeLayoutMetrics).toBeDefined();
    expect(runnersBarrel.createEmptyDomPhysicsSnapshot).toBeDefined();
    expect(runnersBarrel.extractDomPhysics).toBeDefined();
  });
});
