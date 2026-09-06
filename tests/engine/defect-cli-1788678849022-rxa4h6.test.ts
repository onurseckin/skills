import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_MESSAGE,
  formatGenesisLedgerError,
  evaluateGenesisLedgerState,
  auditAgentRegisterGenesisLoading,
  type GenesisLedgerInspection,
  type Defect1788678849022Rxa4h6Result,
} from "../../olt/scripts/src/engine/defect-cli-1788678849022-rxa4h6.ts";

describe("Defect Remediation: defect-cli-1788678849022-rxa4h6", () => {
  test("exports constants with correct values", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788678849022-rxa4h6");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_MESSAGE).toContain("agent:register could not load capsule state");
    expect(DEFECT_MESSAGE).toContain("first-grant genesis requires a readable empty agent ledger");
  });

  test("formatGenesisLedgerError formats error string with defaults and custom parameters", () => {
    const defaultMsg = formatGenesisLedgerError();
    expect(defaultMsg).toContain("--run supervisory-cadence-and-mechanical-interlocks");
    expect(defaultMsg).toBe(DEFECT_MESSAGE);

    const customRunMsg = formatGenesisLedgerError("custom-run-identifier");
    expect(customRunMsg).toContain("--run custom-run-identifier");

    const withDetails = formatGenesisLedgerError("test-run", "ENOENT: file not found");
    expect(withDetails).toContain("ENOENT: file not found");
    expect(withDetails).toContain("--run test-run");

    const emptyRun = formatGenesisLedgerError("");
    expect(emptyRun).toContain("--run supervisory-cadence-and-mechanical-interlocks");
  });

  test("evaluateGenesisLedgerState correctly determines validity for genesis and subsequent states", () => {
    const unreadableGenesis: GenesisLedgerInspection = {
      runId: "run-alpha",
      isReadable: false,
      agentCount: 0,
      isFirstGrantGenesis: true,
    };
    expect(evaluateGenesisLedgerState(unreadableGenesis)).toBe(false);

    const readableEmptyGenesis: GenesisLedgerInspection = {
      runId: "run-alpha",
      isReadable: true,
      agentCount: 0,
      isFirstGrantGenesis: true,
    };
    expect(evaluateGenesisLedgerState(readableEmptyGenesis)).toBe(true);

    const readableNonEmptyGenesis: GenesisLedgerInspection = {
      runId: "run-alpha",
      isReadable: true,
      agentCount: 2,
      isFirstGrantGenesis: true,
    };
    expect(evaluateGenesisLedgerState(readableNonEmptyGenesis)).toBe(false);

    const readableSubsequentGrant: GenesisLedgerInspection = {
      runId: "run-alpha",
      isReadable: true,
      agentCount: 2,
      isFirstGrantGenesis: false,
    };
    expect(evaluateGenesisLedgerState(readableSubsequentGrant)).toBe(true);

    const negativeAgentCount: GenesisLedgerInspection = {
      runId: "run-alpha",
      isReadable: true,
      agentCount: -1,
      isFirstGrantGenesis: false,
    };
    expect(evaluateGenesisLedgerState(negativeAgentCount)).toBe(false);
  });

  test("auditAgentRegisterGenesisLoading validates valid readable empty ledger", () => {
    const inspection: Partial<GenesisLedgerInspection> = {
      runId: "supervisory-cadence-and-mechanical-interlocks",
      isReadable: true,
      agentCount: 0,
      isFirstGrantGenesis: true,
      capsulePath: "/path/to/capsule",
      ledgerExists: true,
    };

    const result: Defect1788678849022Rxa4h6Result = auditAgentRegisterGenesisLoading(inspection);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.inspection.isReadable).toBe(true);
    expect(result.inspection.agentCount).toBe(0);
  });

  test("auditAgentRegisterGenesisLoading reports error for unreadable capsule state", () => {
    const inspection: Partial<GenesisLedgerInspection> = {
      runId: "supervisory-cadence-and-mechanical-interlocks",
      isReadable: false,
      rawError: "capsule state corrupted",
    };

    const result = auditAgentRegisterGenesisLoading(inspection);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain(
      "first-grant genesis requires a readable empty agent ledger",
    );
    expect(result.errors[0]).toContain("capsule state corrupted");
  });

  test("auditAgentRegisterGenesisLoading reports error for non-empty genesis state", () => {
    const inspection: Partial<GenesisLedgerInspection> = {
      runId: "supervisory-cadence-and-mechanical-interlocks",
      isReadable: true,
      agentCount: 3,
      isFirstGrantGenesis: true,
    };

    const result = auditAgentRegisterGenesisLoading(inspection);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("found 3 existing agents");
  });

  test("auditAgentRegisterGenesisLoading handles default empty inspection safely", () => {
    const result = auditAgentRegisterGenesisLoading();
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.inspection.runId).toBe("supervisory-cadence-and-mechanical-interlocks");
    expect(result.inspection.isReadable).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
