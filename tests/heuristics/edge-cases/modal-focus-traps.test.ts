/**
 * @file modal-focus-traps.test.ts
 * Modular unit tests for Modal Focus Traps and Inert Shielding Heuristics
 */

import { describe, expect, it } from "bun:test";
import {
  validateModalFocusTrap,
  type ModalFocusTrapInput,
} from "../../../../olt/scripts/src/heuristics/modal-focus-traps/index.ts";

describe("Extended Heuristics: Modal Focus Traps", () => {
  it("certifies a correctly configured and trapped modal dialog", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#auth-dialog",
      isOpen: true,
      role: "dialog",
      ariaModal: true,
      focusableElements: [
        { selector: "#email-input", tabIndex: 0, isInsideModal: true },
        { selector: "#password-input", tabIndex: 0, isInsideModal: true },
        { selector: "#submit-btn", tabIndex: 0, isInsideModal: true },
        { selector: "#close-btn", tabIndex: 0, isInsideModal: true },
      ],
      outsideSiblings: [
        { selector: "#app-header", ariaHidden: true },
        { selector: "#main-content", isInert: true },
      ],
      bodyStyles: {
        overflow: "hidden",
        position: "fixed",
        touchAction: "none",
        isScrollLocked: true,
      },
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(true);
    expect(result.isContained).toBe(true);
    expect(result.ariaHiddenInertCompliant).toBe(true);
    expect(result.scrollLockCompliant).toBe(true);
    expect(result.defects.length).toBe(0);
  });

  it("flags modal when focus escapes to outside element during Tab transition", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#bad-modal",
      isOpen: true,
      role: "dialog",
      ariaModal: true,
      focusableElements: [
        { selector: "#btn-1", tabIndex: 0, isInsideModal: true },
        { selector: "#btn-2", tabIndex: 0, isInsideModal: true },
      ],
      customTransitions: [
        {
          fromSelector: "#btn-2",
          toSelector: "#header-nav-link",
          key: "Tab",
          targetIsInsideModal: false,
        },
      ],
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(false);
    expect(result.isContained).toBe(false);
    expect(result.defects.some((d) => d.category === "modal-focus-escaped")).toBe(true);
  });

  it("flags modal with self aria-hidden or inert attributes", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#broken-dialog",
      isOpen: true,
      ariaModal: true,
      ariaHidden: true,
      focusableElements: [{ selector: "#btn-ok", tabIndex: 0, isInsideModal: true }],
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(false);
    expect(result.defects.some((d) => d.category === "modal-self-aria-hidden")).toBe(true);
  });

  it("flags modal with 0 active focusable elements", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#empty-dialog",
      isOpen: true,
      ariaModal: true,
      focusableElements: [{ selector: "#disabled-btn", disabled: true }],
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(false);
    expect(result.defects.some((d) => d.category === "modal-zero-focusable")).toBe(true);
  });

  it("flags unshielded outside siblings and body scroll-lock leakage", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#dialog",
      isOpen: true,
      ariaModal: true,
      focusableElements: [{ selector: "#btn-save", tabIndex: 0, isInsideModal: true }],
      outsideSiblings: [{ selector: "#sidebar", ariaHidden: false, isInert: false }],
      bodyStyles: {
        overflow: "visible",
      },
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(false);
    expect(result.ariaHiddenInertCompliant).toBe(false);
    expect(result.scrollLockCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "modal-aria-hidden-leak")).toBe(true);
    expect(result.defects.some((d) => d.category === "modal-scroll-leakage")).toBe(true);
  });

  it("skips verification gracefully when modal is closed", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#closed-dialog",
      isOpen: false,
      focusableElements: [],
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(true);
    expect(result.defects.length).toBe(0);
  });
});
