import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  ParameterExtractor,
  getDefaultParameterExtractor,
  setDefaultParameterExtractor,
  resetDefaultParameterExtractor,
} from "../fixtures.ts";

describe("Parameter Extractor - Validation & Scopes", () => {
  beforeEach(() => {
    resetDefaultParameterExtractor();
  });

  afterEach(() => {
    resetDefaultParameterExtractor();
  });

  describe("Persona Scopes, Validation & Workspace Policy", () => {
    it("filters personas for specific feature scopes", () => {
      const extractor = new ParameterExtractor();
      const params = extractor.getDefaultParameters();

      const adminPersonas = extractor.getPersonasForFeature("administration", params);
      expect(adminPersonas.map((p) => p.role)).toContain("admin");
      expect(adminPersonas.map((p) => p.role)).not.toContain("standard_user");

      const authPersonas = extractor.getPersonasForFeature("authentication", params);
      expect(authPersonas.map((p) => p.role)).toContain("guest");
      expect(authPersonas.map((p) => p.role)).toContain("standard_user");
    });

    it("validates parameters and reports errors for broken configurations", () => {
      const extractor = new ParameterExtractor();
      const brokenParams = {
        ...extractor.getDefaultParameters(),
        endpoints: {
          ...extractor.getDefaultParameters().endpoints,
          baseUrl: "invalid-url",
          port: -1,
          healthEndpoint: "not-a-url",
        },
        personas: {},
      };

      const validation = extractor.validateParameters(brokenParams);
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some((e) => e.includes("baseUrl"))).toBe(true);
      expect(validation.errors.some((e) => e.includes("port"))).toBe(true);
      expect(validation.errors.some((e) => e.includes("personas"))).toBe(true);
    });

    it("extracts parameters from workspace policy file if present", () => {
      const extractor = new ParameterExtractor();
      const params = extractor.extractFromWorkspace();
      expect(params).toBeDefined();
      expect(params.endpoints.baseUrl).toBeDefined();
      expect(params.personas.admin).toBeDefined();
    });

    it("manages singleton instance correctly", () => {
      const defaultExtractor = getDefaultParameterExtractor();
      expect(defaultExtractor).toBeInstanceOf(ParameterExtractor);

      const customExtractor = new ParameterExtractor();
      setDefaultParameterExtractor(customExtractor);
      expect(getDefaultParameterExtractor()).toBe(customExtractor);
    });
  });
});
