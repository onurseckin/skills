/**
 * Health Vendors Subdomain Test Facade.
 * Explicit named exports for vendor identifiers, vendor names, and prose qualification checks.
 */

export {
  checkVendorIdentifiers,
  checkUnqualifiedDispatch,
  type TreeTarget,
} from "../../../olt/scripts/src/health/vendors.ts";

export { VENDOR_NAMES } from "../../../olt/scripts/src/health/vendor-names.ts";
