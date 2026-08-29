/**
 * @file modal-focus-traps.ts
 * Facade for Extended Modal Focus Trap & Accessibility Containment Validator
 */

export { validateModalFocusTrap } from "./modal-focus-traps/index.ts";

export type {
  BodyScrollState,
  FocusCycleReport,
  FocusSequenceTransition,
  FocusableNode,
  ModalFocusTrapDefect,
  ModalFocusTrapInput,
  ModalFocusTrapResult,
  OutsideSiblingNode,
} from "./modal-focus-traps/index.ts";
