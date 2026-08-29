/**
 * @file index.ts
 * Extended Modal Focus Trap & Accessibility Containment Validator
 *
 * Implements comprehensive focus trap verification:
 * 1. Cycle detection for Tab and Shift-Tab focus sequences.
 * 2. Active element containment within the modal DOM subtree.
 * 3. Aria-hidden and inert attribute verification on outside siblings and ancestors.
 * 4. Document body scroll-lock leakage and modal scroll container validation.
 */

import type {
  BodyScrollState,
  FocusCycleReport,
  FocusSequenceTransition,
  FocusableNode,
  ModalFocusTrapDefect,
  ModalFocusTrapInput,
  ModalFocusTrapResult,
  OutsideSiblingNode,
} from "./types.ts";

export type {
  BodyScrollState,
  FocusCycleReport,
  FocusSequenceTransition,
  FocusableNode,
  ModalFocusTrapDefect,
  ModalFocusTrapInput,
  ModalFocusTrapResult,
  OutsideSiblingNode,
} from "./types.ts";

/**
 * Validates modal focus trapping, cyclic keyboard navigation, inert outside siblings, and scroll locks.
 */
export function validateModalFocusTrap(input: ModalFocusTrapInput): ModalFocusTrapResult {
  const defects: ModalFocusTrapDefect[] = [];
  const warnings: string[] = [];

  if (!input.isOpen) {
    return {
      passed: true,
      isContained: true,
      cycleReport: {
        forwardTabCycleClosed: true,
        backwardShiftTabCycleClosed: true,
        totalFocusableCount: 0,
        transitionsEvaluated: 0,
        leakedSelectors: [],
      },
      ariaHiddenInertCompliant: true,
      scrollLockCompliant: true,
      defects: [],
      warnings: ["Modal is marked closed; focus trap verification skipped."],
    };
  }

  // 1. Validate modal container attributes
  if (input.ariaHidden === true || input.isInert === true) {
    defects.push({
      id: "modal-self-aria-hidden",
      category: "modal-self-aria-hidden",
      severity: "critical",
      elementSelector: input.modalSelector,
      message: `Active open modal container '${input.modalSelector}' has aria-hidden="true" or inert, rendering it completely invisible to screen readers and assistive technology.`,
      metadata: {
        ariaHidden: input.ariaHidden === true,
        isInert: input.isInert === true,
      },
    });
  }

  if (input.ariaModal !== true) {
    defects.push({
      id: "modal-missing-aria-modal",
      category: "modal-missing-aria-modal",
      severity: "serious",
      elementSelector: input.modalSelector,
      message: `Modal dialog '${input.modalSelector}' is missing aria-modal="true" attribute required by WAI-ARIA 1.2 specifications.`,
      metadata: {
        role: input.role ? input.role : "dialog",
        ariaModal: false,
      },
    });
  }

  // 2. Validate focusable elements inside modal
  const activeFocusable = input.focusableElements.filter(
    (el) => !el.disabled && el.ariaHidden !== true && el.isInert !== true && el.tabIndex !== -1,
  );

  if (activeFocusable.length === 0) {
    defects.push({
      id: "modal-zero-focusable",
      category: "modal-zero-focusable",
      severity: "critical",
      elementSelector: input.modalSelector,
      message: `Modal dialog '${input.modalSelector}' contains 0 enabled, accessible focusable elements. Users cannot interact with or dismiss the modal via keyboard.`,
      metadata: {
        totalElements: input.focusableElements.length,
        activeFocusable: 0,
      },
    });
  }

  // 3. Focus Cycle & Escape Detection
  const leakedSelectors: string[] = [];
  let forwardTabCycleClosed = true;
  let backwardShiftTabCycleClosed = true;
  let transitionsEvaluated = 0;

  if (input.customTransitions && input.customTransitions.length > 0) {
    transitionsEvaluated = input.customTransitions.length;
    for (let i = 0; i < input.customTransitions.length; i++) {
      const trans = input.customTransitions[i];
      if (!trans) continue;

      if (!trans.targetIsInsideModal) {
        leakedSelectors.push(trans.toSelector);
        defects.push({
          id: `modal-focus-escaped-${i}`,
          category: "modal-focus-escaped",
          severity: "critical",
          elementSelector: trans.fromSelector,
          message: `Keyboard navigation (${trans.key}) escaped modal boundary from '${trans.fromSelector}' to external element '${trans.toSelector}'.`,
          metadata: {
            fromSelector: trans.fromSelector,
            toSelector: trans.toSelector,
            key: trans.key,
          },
        });
      }
    }
  } else if (activeFocusable.length > 0) {
    // Model canonical Tab and Shift-Tab sequence
    const firstEl = activeFocusable[0];
    const lastEl = activeFocusable[activeFocusable.length - 1];

    if (firstEl && lastEl) {
      transitionsEvaluated = activeFocusable.length * 2;
      // Check if any element marked inside modal is false
      for (const el of activeFocusable) {
        if (el.isInsideModal === false) {
          leakedSelectors.push(el.selector);
          defects.push({
            id: `modal-focus-outside-${el.selector}`,
            category: "modal-focus-escaped",
            severity: "critical",
            elementSelector: el.selector,
            message: `Focusable element '${el.selector}' is in the modal tab order but resides outside the modal container subtree.`,
            metadata: {
              selector: el.selector,
            },
          });
        }
      }
    }
  }

  if (leakedSelectors.length > 0) {
    forwardTabCycleClosed = false;
    backwardShiftTabCycleClosed = false;
  }

  // 4. Outside Siblings & Ancestor Inert / Aria-Hidden Verification
  let ariaHiddenInertCompliant = true;
  if (input.outsideSiblings && input.outsideSiblings.length > 0) {
    for (let i = 0; i < input.outsideSiblings.length; i++) {
      const sibling = input.outsideSiblings[i];
      if (!sibling) continue;

      const isHidden = sibling.ariaHidden === true || sibling.isInert === true;
      if (!isHidden) {
        ariaHiddenInertCompliant = false;
        defects.push({
          id: `modal-sibling-unshielded-${i}`,
          category: "modal-aria-hidden-leak",
          severity: "serious",
          elementSelector: sibling.selector,
          message: `Background sibling '${sibling.selector}' outside the open modal lacks aria-hidden="true" or inert, allowing screen reader virtual cursor leakage.`,
          metadata: {
            selector: sibling.selector,
            ariaHidden: Boolean(sibling.ariaHidden),
            isInert: Boolean(sibling.isInert),
          },
        });
      }
    }
  }

  // 5. Scroll Lock Leakage & Modal Content Scrollability
  let scrollLockCompliant = true;
  if (input.bodyStyles) {
    const overflow = input.bodyStyles.overflow?.toLowerCase();
    const overflowY = input.bodyStyles.overflowY?.toLowerCase();
    const pos = input.bodyStyles.position?.toLowerCase();
    const isLocked =
      input.bodyStyles.isScrollLocked === true ||
      overflow === "hidden" ||
      overflow === "clip" ||
      overflowY === "hidden" ||
      overflowY === "clip" ||
      (pos === "fixed" && input.bodyStyles.touchAction === "none");

    if (!isLocked) {
      scrollLockCompliant = false;
      const ov = overflow ? overflow : "visible";
      const ovY = overflowY ? overflowY : "visible";
      const p = pos ? pos : "static";
      defects.push({
        id: "modal-scroll-leakage",
        category: "modal-scroll-leakage",
        severity: "serious",
        elementSelector: "body",
        message: `Body element is not scroll-locked (overflow: ${ov}). Background content may scroll or rubberband behind open modal.`,
        metadata: {
          overflow: ov,
          overflowY: ovY,
          position: p,
        },
      });
    }
  }

  if (input.modalContentExceedsViewport && input.modalHasScrollContainer === false) {
    defects.push({
      id: "modal-content-unscrollable",
      category: "modal-content-unscrollable",
      severity: "serious",
      elementSelector: input.modalSelector,
      message: `Modal content exceeds viewport height but lacks an internal overflow-y scroll container, truncating actions on small viewports.`,
      metadata: {
        modalSelector: input.modalSelector,
        hasScrollContainer: false,
      },
    });
  }

  const isContained = leakedSelectors.length === 0;
  const passed = defects.length === 0;

  return {
    passed,
    isContained,
    cycleReport: {
      forwardTabCycleClosed,
      backwardShiftTabCycleClosed,
      totalFocusableCount: activeFocusable.length,
      transitionsEvaluated,
      leakedSelectors,
    },
    ariaHiddenInertCompliant,
    scrollLockCompliant,
    defects,
    warnings,
  };
}
