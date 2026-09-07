import { describe, expect, it } from "bun:test";
import {
  jsonSchemaToToolDefinition,
  toCamelCase,
  toolDefinitionToJsonSchema,
  toolParameterToJsonSchemaProperty,
  toPascalCase,
  type JsonSchemaDocument,
  type ToolDefinition,
  type ToolParameter,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Tool Schema Codegen & Converter Suite", () => {
  describe("String case formatting utilities", () => {
    it("converts snake_case, kebab-case and spaced names to PascalCase", () => {
      expect(toPascalCase("fetch_remote_data")).toBe("FetchRemoteData");
      expect(toPascalCase("git-commit-diff")).toBe("GitCommitDiff");
      expect(toPascalCase("system metrics collector")).toBe("SystemMetricsCollector");
      expect(toPascalCase("alreadyPascalCase")).toBe("AlreadyPascalCase");
    });

    it("converts various naming styles to camelCase", () => {
      expect(toCamelCase("fetch_remote_data")).toBe("fetchRemoteData");
      expect(toCamelCase("GitCommitDiff")).toBe("gitCommitDiff");
      expect(toCamelCase("custom-tool-name")).toBe("customToolName");
    });
  });

  describe("ToolParameter to JSON Schema Property", () => {
    it("converts primitive parameter definitions accurately", () => {
      const param: ToolParameter = {
        name: "targetUrl",
        type: "string",
        description: "Target URL to probe",
        required: true,
        pattern: "^https?://",
        minLength: 5,
        maxLength: 200,
      };

      const prop = toolParameterToJsonSchemaProperty(param);
      expect(prop.type).toBe("string");
      expect(prop.description).toBe("Target URL to probe");
      expect(prop.pattern).toBe("^https?://");
      expect(prop.minLength).toBe(5);
      expect(prop.maxLength).toBe(200);
    });

    it("converts number parameters with range and enum constraints", () => {
      const param: ToolParameter = {
        name: "port",
        type: "number",
        description: "Server port number",
        defaultValue: 8080,
        minimum: 1,
        maximum: 65535,
        enumValues: [80, 443, 8080, 8443],
      };

      const prop = toolParameterToJsonSchemaProperty(param);
      expect(prop.type).toBe("number");
      expect(prop.default).toBe(8080);
      expect(prop.minimum).toBe(1);
      expect(prop.maximum).toBe(65535);
      expect(prop.enum).toEqual([80, 443, 8080, 8443]);
    });

    it("converts array parameters with itemType", () => {
      const param: ToolParameter = {
        name: "tags",
        type: "array",
        description: "List of tags",
        itemType: "string",
      };

      const prop = toolParameterToJsonSchemaProperty(param);
      expect(prop.type).toBe("array");
      expect(prop.items?.type).toBe("string");
    });

    it("converts nested object parameters with recursive properties", () => {
      const param: ToolParameter = {
        name: "config",
        type: "object",
        description: "Configuration block",
        properties: [
          {
            name: "retries",
            type: "number",
            description: "Retry count",
            required: true,
          },
          {
            name: "endpoint",
            type: "string",
            description: "Endpoint URI",
            required: false,
          },
        ],
      };

      const prop = toolParameterToJsonSchemaProperty(param);
      expect(prop.type).toBe("object");
      expect(prop.properties?.retries?.type).toBe("number");
      expect(prop.properties?.endpoint?.type).toBe("string");
      expect(prop.required).toEqual(["retries"]);
    });
  });

  describe("ToolDefinition to JSON Schema Document", () => {
    it("converts complete tool definition to JSON schema Draft 7", () => {
      const tool: ToolDefinition = {
        name: "fetch_api_data",
        description: "Fetches remote data from API endpoint",
        category: "network",
        parameters: [
          {
            name: "url",
            type: "string",
            description: "Endpoint URL",
            required: true,
          },
          {
            name: "timeoutMs",
            type: "number",
            description: "Request timeout in ms",
            defaultValue: 5000,
          },
        ],
      };

      const schema = toolDefinitionToJsonSchema(tool);
      expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(schema.type).toBe("object");
      expect(schema.title).toBe("FetchApiDataArgs");
      expect(schema.description).toBe("Fetches remote data from API endpoint");
      expect(schema.required).toEqual(["url"]);
      expect(schema.properties.url.type).toBe("string");
      expect(schema.properties.timeoutMs.default).toBe(5000);
      expect(schema.additionalProperties).toBe(false);
    });
  });

  describe("JSON Schema to ToolDefinition roundtrip", () => {
    it("converts JSON Schema Document back to ToolDefinition", () => {
      const schema: JsonSchemaDocument = {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        title: "QueryDatabaseArgs",
        description: "Executes SQL query against database",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "SQL query string",
          },
          maxRows: {
            type: "integer",
            description: "Maximum rows to return",
            default: 100,
          },
          tags: {
            type: "array",
            description: "Associated tags",
            items: { type: "string" },
          },
        },
      };

      const tool = jsonSchemaToToolDefinition(schema, "query_database", "database");
      expect(tool.name).toBe("query_database");
      expect(tool.description).toBe("Executes SQL query against database");
      expect(tool.category).toBe("database");
      expect(tool.parameters).toHaveLength(3);

      const queryParam = tool.parameters.find((p) => p.name === "query");
      expect(queryParam?.required).toBe(true);
      expect(queryParam?.type).toBe("string");

      const maxRowsParam = tool.parameters.find((p) => p.name === "maxRows");
      expect(maxRowsParam?.type).toBe("number");
      expect(maxRowsParam?.integer).toBe(true);
      expect(maxRowsParam?.defaultValue).toBe(100);

      const tagsParam = tool.parameters.find((p) => p.name === "tags");
      expect(tagsParam?.type).toBe("array");
      expect(tagsParam?.itemType).toBe("string");
    });
  });
});
