import type { CapturePageDriver } from "../types.ts";
import type { SyntheticDomEvent } from "./types.ts";

export const DOM_EVENT_DISPATCH_SCRIPT = `
(payload) => {
  const { type, selector, text, key, scrollX, scrollY, scrollDeltaX, scrollDeltaY, mediaQuery, matches } = payload || {};
  const el = selector ? document.querySelector(selector) : document.body;

  switch (type) {
    case 'click':
    case 'dblclick':
      if (el) {
        if (typeof el.click === 'function') {
          el.click();
        } else {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
        }
      }
      break;
    case 'hover':
    case 'mouseenter':
      if (el) {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }));
      }
      break;
    case 'mouseleave':
      if (el) {
        el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: true }));
      }
      break;
    case 'scroll':
      if (scrollX !== undefined && scrollY !== undefined) {
        const target = selector ? el : window;
        if (target && typeof target.scrollTo === 'function') {
          target.scrollTo(scrollX, scrollY);
        }
      } else if (scrollDeltaX !== undefined || scrollDeltaY !== undefined) {
        const target = selector ? el : window;
        if (target && typeof target.scrollBy === 'function') {
          target.scrollBy(scrollDeltaX || 0, scrollDeltaY || 0);
        }
      }
      break;
    case 'focus':
      if (el && typeof el.focus === 'function') {
        el.focus();
        el.dispatchEvent(new FocusEvent('focus', { bubbles: false, cancelable: false }));
        el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: false }));
      }
      break;
    case 'blur':
      if (el && typeof el.blur === 'function') {
        el.blur();
        el.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: false }));
        el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: false }));
      }
      break;
    case 'keypress':
    case 'keydown':
    case 'keyup':
    case 'input':
      if (el) {
        if (text !== undefined && 'value' in el) {
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (key) {
          el.dispatchEvent(new KeyboardEvent(type === 'keyup' ? 'keyup' : 'keydown', {
            key,
            bubbles: true,
            cancelable: true
          }));
        }
      }
      break;
    case 'mediaQuery':
      if (mediaQuery && mediaQuery.includes('prefers-color-scheme: dark')) {
        document.documentElement.classList.toggle('dark', Boolean(matches));
        document.documentElement.setAttribute('data-theme', matches ? 'dark' : 'light');
      } else if (mediaQuery && mediaQuery.includes('prefers-reduced-motion')) {
        document.documentElement.setAttribute('data-reduced-motion', matches ? 'true' : 'false');
      }
      break;
  }
}
`;

/**
 * Dispatches a simulated interactive event to a CapturePageDriver.
 */
export async function simulateDomEvent(
  driver: CapturePageDriver,
  event: SyntheticDomEvent,
): Promise<void> {
  switch (event.type) {
    case "click":
    case "dblclick": {
      if (event.selector && driver.click) {
        await driver.click(event.selector);
      } else if (event.selector) {
        await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
          type: event.type,
          selector: event.selector,
        });
      }
      break;
    }

    case "hover":
    case "mouseenter":
    case "mouseleave": {
      if (
        (event.type === "hover" || event.type === "mouseenter") &&
        event.selector &&
        driver.hover
      ) {
        await driver.hover(event.selector);
      } else if (event.selector) {
        await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
          type: event.type,
          selector: event.selector,
        });
      }
      break;
    }

    case "scroll": {
      await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
        type: "scroll",
        selector: event.selector,
        scrollX: event.scrollTarget?.x,
        scrollY: event.scrollTarget?.y,
        scrollDeltaX: event.scrollDelta?.deltaX,
        scrollDeltaY: event.scrollDelta?.deltaY,
      });
      break;
    }

    case "focus":
    case "blur": {
      if (event.selector) {
        await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
          type: event.type,
          selector: event.selector,
        });
      }
      break;
    }

    case "keypress":
    case "keydown":
    case "keyup":
    case "input": {
      if (event.text !== undefined && event.selector && driver.fill) {
        await driver.fill(event.selector, event.text);
      } else if (event.selector) {
        await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
          type: event.type,
          selector: event.selector,
          text: event.text,
          key: event.key,
        });
      }
      break;
    }

    case "resize": {
      if (event.viewport) {
        await driver.setViewportSize(event.viewport);
      }
      break;
    }

    case "mediaQuery": {
      if (event.mediaQuery) {
        await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
          type: "mediaQuery",
          mediaQuery: event.mediaQuery.query,
          matches: event.mediaQuery.matches,
        });
      }
      break;
    }

    case "wait": {
      const waitMs = typeof event.delayMs === "number" ? event.delayMs : 100;
      if (driver.waitForTimeout) {
        await driver.waitForTimeout(waitMs);
      } else {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      break;
    }

    case "custom": {
      if (event.customAction) {
        await event.customAction(driver);
      }
      break;
    }
  }
}
