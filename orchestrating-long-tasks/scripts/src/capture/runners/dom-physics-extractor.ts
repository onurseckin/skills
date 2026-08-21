import type {
  AABB,
  CapturePageDriver,
  DomPhysicsSnapshot,
  ExtractedComputedStyles,
  ExtractedElementMetrics,
  ExtractedElementPhysics,
  LayoutOverflowEntry,
  TextClippingEntry,
} from "./types.ts";

export const DOM_PHYSICS_EXTRACTION_SCRIPT = `
(() => {
  const elements = [];
  const layoutOverflows = [];
  const textClippings = [];
  const tolerance = 0.5;

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  function buildSelector(el) {
    if (el.id) return '#' + el.id;
    let path = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\\s+/).filter(c => c.length > 0 && !c.includes(':')).slice(0, 2);
      if (classes.length > 0) {
        path += '.' + classes.join('.');
      }
    }
    return path;
  }

  const allNodes = document.querySelectorAll('*');
  for (let i = 0; i < allNodes.length; i++) {
    const el = allNodes[i];
    if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) continue;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const rect = el.getBoundingClientRect();
    const bounds = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    };

    const selector = buildSelector(el);
    const role = el.getAttribute('role') || undefined;
    const ariaLabel = el.getAttribute('aria-label') || undefined;

    const computedStyles = {
      display: style.display,
      position: style.position,
      zIndex: style.zIndex === 'auto' ? 0 : parseInt(style.zIndex, 10) || style.zIndex,
      color: style.color,
      backgroundColor: style.backgroundColor,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      opacity: style.opacity,
      visibility: style.visibility,
    };

    const metrics = {
      scrollWidth: el.scrollWidth || rect.width,
      clientWidth: el.clientWidth || rect.width,
      scrollHeight: el.scrollHeight || rect.height,
      clientHeight: el.clientHeight || rect.height,
      offsetWidth: el.offsetWidth || rect.width,
      offsetHeight: el.offsetHeight || rect.height,
    };

    const diffX = metrics.scrollWidth - metrics.clientWidth;
    if (diffX >= tolerance && (computedStyles.overflowX === 'hidden' || computedStyles.overflowX === 'scroll' || computedStyles.overflowX === 'auto' || diffX > 2)) {
      layoutOverflows.push({
        selector,
        overflowX: diffX,
        scrollWidth: metrics.scrollWidth,
        clientWidth: metrics.clientWidth,
      });
    }

    const diffY = metrics.scrollHeight - metrics.clientHeight;
    if (diffY >= tolerance && computedStyles.overflowY === 'hidden' && el.textContent && el.textContent.trim().length > 0) {
      textClippings.push({
        selector,
        clippingY: diffY,
        scrollHeight: metrics.scrollHeight,
        clientHeight: metrics.clientHeight,
      });
    }

    elements.push({
      selector,
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      role,
      ariaLabel,
      bounds,
      computedStyles,
      metrics,
      textSnippet: el.textContent ? el.textContent.trim().slice(0, 100) : undefined,
    });
  }

  return {
    viewport: {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: window.devicePixelRatio || 1,
    },
    scrollPosition: { x: scrollX, y: scrollY },
    elements: elements.slice(0, 500),
    layoutOverflows,
    textClippings,
    capturedAt: new Date().toISOString(),
  };
})()
`;

export function computeLayoutMetrics(
  elements: readonly ExtractedElementPhysics[],
  viewportWidth: number,
  viewportHeight: number,
  subpixelTolerance: number = 0.5,
): {
  layoutOverflows: readonly LayoutOverflowEntry[];
  textClippings: readonly TextClippingEntry[];
} {
  const layoutOverflows: LayoutOverflowEntry[] = [];
  const textClippings: TextClippingEntry[] = [];

  for (const el of elements) {
    const scrollDiffX = el.metrics.scrollWidth - el.metrics.clientWidth;
    const vpBoundDiffX =
      viewportWidth > 0 && el.bounds.right > viewportWidth + subpixelTolerance && el.computedStyles.position !== "fixed"
        ? el.bounds.right - viewportWidth
        : 0;
    const diffX = Math.max(scrollDiffX, vpBoundDiffX);

    if (diffX >= subpixelTolerance) {
      layoutOverflows.push({
        selector: el.selector,
        overflowX: diffX,
        scrollWidth: el.metrics.scrollWidth,
        clientWidth: el.metrics.clientWidth,
      });
    }

    const scrollDiffY = el.metrics.scrollHeight - el.metrics.clientHeight;
    const vpBoundDiffY =
      viewportHeight > 0 && el.bounds.bottom > viewportHeight + subpixelTolerance && el.computedStyles.position === "fixed"
        ? el.bounds.bottom - viewportHeight
        : 0;
    const diffY = Math.max(scrollDiffY, vpBoundDiffY);

    if (
      diffY >= subpixelTolerance &&
      el.computedStyles.overflowY === "hidden" &&
      el.textSnippet &&
      el.textSnippet.length > 0
    ) {
      textClippings.push({
        selector: el.selector,
        clippingY: diffY,
        scrollHeight: el.metrics.scrollHeight,
        clientHeight: el.metrics.clientHeight,
      });
    }
  }

  return { layoutOverflows, textClippings };
}

export function createEmptyDomPhysicsSnapshot(
  width: number = 1440,
  height: number = 900,
  deviceScaleFactor: number = 1,
): DomPhysicsSnapshot {
  return {
    viewport: { width, height, deviceScaleFactor },
    scrollPosition: { x: 0, y: 0 },
    elements: [],
    layoutOverflows: [],
    textClippings: [],
    capturedAt: new Date().toISOString(),
  };
}

export async function extractDomPhysics(
  driver: CapturePageDriver,
  fallbackViewport?: { width: number; height: number; deviceScaleFactor?: number },
): Promise<DomPhysicsSnapshot> {
  try {
    const rawResult = await driver.evaluate<DomPhysicsSnapshot>(DOM_PHYSICS_EXTRACTION_SCRIPT);
    if (rawResult && typeof rawResult === "object" && Array.isArray(rawResult.elements)) {
      return rawResult;
    }
  } catch (_err) {
    // If evaluate fails (e.g. mock page or detached target), construct fallback snapshot
  }

  return createEmptyDomPhysicsSnapshot(
    fallbackViewport?.width ?? 1440,
    fallbackViewport?.height ?? 900,
    fallbackViewport?.deviceScaleFactor ?? 1,
  );
}
