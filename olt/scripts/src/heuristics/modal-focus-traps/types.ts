export interface FocusableNode {
  readonly selector: string;
  readonly tabIndex?: number;
  readonly disabled?: boolean;
  readonly ariaHidden?: boolean;
  readonly isInert?: boolean;
  readonly isSentinel?: boolean;
  readonly isInsideModal?: boolean;
  readonly tagName?: string;
  readonly role?: string;
}

export interface FocusSequenceTransition {
  readonly fromSelector: string;
  readonly toSelector: string;
  readonly key: "Tab" | "Shift+Tab";
  readonly targetIsInsideModal: boolean;
}

export interface OutsideSiblingNode {
  readonly selector: string;
  readonly ariaHidden?: boolean;
  readonly isInert?: boolean;
  readonly role?: string;
}

export interface BodyScrollState {
  readonly overflow?: string;
  readonly overflowY?: string;
  readonly position?: string;
  readonly touchAction?: string;
  readonly isScrollLocked?: boolean;
}

export interface ModalFocusTrapInput {
  readonly modalSelector: string;
  readonly isOpen: boolean;
  readonly role?: "dialog" | "alertdialog" | string;
  readonly ariaModal?: boolean;
  readonly ariaHidden?: boolean;
  readonly isInert?: boolean;
  readonly focusableElements: readonly FocusableNode[];
  readonly customTransitions?: readonly FocusSequenceTransition[];
  readonly outsideSiblings?: readonly OutsideSiblingNode[];
  readonly bodyStyles?: BodyScrollState;
  readonly modalHasScrollContainer?: boolean;
  readonly modalContentExceedsViewport?: boolean;
}

export interface ModalFocusTrapDefect {
  readonly id: string;
  readonly category:
    | "modal-cycle-broken"
    | "modal-focus-escaped"
    | "modal-zero-focusable"
    | "modal-aria-hidden-leak"
    | "modal-self-aria-hidden"
    | "modal-scroll-leakage"
    | "modal-missing-aria-modal"
    | "modal-content-unscrollable";
  readonly severity: "critical" | "serious" | "moderate" | "minor";
  readonly elementSelector: string;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface FocusCycleReport {
  readonly forwardTabCycleClosed: boolean;
  readonly backwardShiftTabCycleClosed: boolean;
  readonly totalFocusableCount: number;
  readonly transitionsEvaluated: number;
  readonly leakedSelectors: readonly string[];
}

export interface ModalFocusTrapResult {
  readonly passed: boolean;
  readonly isContained: boolean;
  readonly cycleReport: FocusCycleReport;
  readonly ariaHiddenInertCompliant: boolean;
  readonly scrollLockCompliant: boolean;
  readonly defects: readonly ModalFocusTrapDefect[];
  readonly warnings: readonly string[];
}
