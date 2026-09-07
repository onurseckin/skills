import { describe, expect, it } from "bun:test";
import {
  generateToolCatalogTypeScript,
  jsonSchemaToToolDefinition,
  toolDefinitionToJsonSchema,
  toolDefinitionToTypeScript,
  type JsonSchemaDocument,
  type ToolDefinition,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Tool Schema TypeScript Codegen Suite", () => {
  describe("TypeScript Type Codegen", () => {
    it("generates TypeScript interface for tool definition", () => {
      const tool: ToolDefinition = {
        name: "scan_ports",
        description: "Scans open ports",
        category: "security",
        parameters: [
          {
            name: "host",
            type: "string",
            description: "Target host",
            required: true,
          },
          {
            name: "ports",
            type: "array",
            itemType: "number",
            description: "List of ports",
            required: false,
          },
          {
            name: "protocol",
            type: "string",
            description: "Transport protocol",
            enumValues: ["tcp", "udp"],
            required: true,
          },
        ],
      };

      const tsCode = toolDefinitionToTypeScript(tool, {
        exportType: "interface",
        includeHandlerSignature: true,
      });

      expect(tsCode).toContain("export interface ScanPortsArgs");
      expect(tsCode).toContain("host: string;");
      expect(tsCode).toContain("ports?: number[];");
      expect(tsCode).toContain('protocol: "tcp" | "udp";');
      expect(tsCode).toContain("export type ScanPortsHandler");
    });

    it("generates TypeScript catalog type mapping for multiple tools", () => {
      const tools: ToolDefinition[] = [
        {
          name: "tool_alpha",
          description: "Tool Alpha",
          category: "test",
          parameters: [
            { name: "alphaVal", type: "string", description: "Alpha val", required: true },
          ],
        },
        {
          name: "tool_beta",
          description: "Tool Beta",
          category: "test",
          parameters: [{ name: "betaVal", type: "number", description: "Beta val" }],
        },
      ];

      const catalogCode = generateToolCatalogTypeScript(tools, "AppTools");
      expect(catalogCode).toContain("export interface ToolAlphaArgs");
      expect(catalogCode).toContain("export interface ToolBetaArgs");
      expect(catalogCode).toContain("export interface AppToolsMap");
      expect(catalogCode).toContain('"tool_alpha": ToolAlphaArgs;');
      expect(catalogCode).toContain('"tool_beta": ToolBetaArgs;');
      expect(catalogCode).toContain("export type AppToolsName = keyof AppToolsMap;");
    });

    it("generates type alias and handles nested object parameters", () => {
      const tool: ToolDefinition = {
        name: "configure_server",
        description: "Configures server instance",
        category: "infra",
        parameters: [
          {
            name: "options",
            type: "object",
            description: "Server options",
            required: true,
            properties: [
              { name: "port", type: "number", description: "Port number", required: true },
              { name: "ssl", type: "boolean", description: "Enable SSL" },
            ],
          },
        ],
      };

      const typeCode = toolDefinitionToTypeScript(tool, { exportType: "type" });
      expect(typeCode).toContain("export type ConfigureServerArgs = {");
      expect(typeCode).toContain("port: number;");
      expect(typeCode).toContain("ssl?: boolean;");
    });

    it("handles array of items and complex properties in schema and codegen", () => {
      const tool: ToolDefinition = {
        name: "batch_process",
        description: "Processes batches of items",
        category: "data",
        parameters: [
          {
            name: "items",
            type: "array",
            itemType: "string",
            description: "List of item identifiers",
            required: true,
          },
          {
            name: "scores",
            type: "array",
            itemType: "number",
            description: "Numeric score list",
          },
        ],
      };

      const schema = toolDefinitionToJsonSchema(tool);
      expect(schema.properties.items.type).toBe("array");
      expect(schema.properties.items.items?.type).toBe("string");
      expect(schema.properties.scores.items?.type).toBe("number");
      expect(schema.required).toEqual(["items"]);

      const tsCode = toolDefinitionToTypeScript(tool);
      expect(tsCode).toContain("items: string[];");
      expect(tsCode).toContain("scores?: number[];");
    });

    it("handles reserved keywords and kebab-cased parameter names in codegen", () => {
      const tool: ToolDefinition = {
        name: "export_data",
        description: "Exports database records",
        category: "database",
        parameters: [
          { name: "export", type: "boolean", description: "Export trigger flag", required: true },
          { name: "default", type: "string", description: "Default fallback value" },
          { name: "delete", type: "boolean", description: "Delete source flag" },
          { name: "custom-header", type: "string", description: "Custom HTTP header" },
        ],
      };

      const schema = toolDefinitionToJsonSchema(tool);
      expect(schema.properties.export.type).toBe("boolean");
      expect(schema.properties.default.type).toBe("string");
      expect(schema.required).toEqual(["export"]);

      const ts = toolDefinitionToTypeScript(tool);
      expect(ts).toContain("export: boolean;");
      expect(ts).toContain("default?: string;");
      expect(ts).toContain("delete?: boolean;");
      expect(ts).toContain("custom-header?: string;");
    });

    it("handles empty and minimal tool definitions without error", () => {
      const minimalTool: ToolDefinition = {
        name: "ping",
        description: "",
        category: "health",
        parameters: [],
      };

      const schema = toolDefinitionToJsonSchema(minimalTool);
      expect(schema.title).toBe("PingArgs");
      expect(schema.description).toBe("");
      expect(schema.properties).toEqual({});
      expect(schema.required).toBeUndefined();

      const ts = toolDefinitionToTypeScript(minimalTool);
      expect(ts).toBe("export interface PingArgs {\n\n}");

      const catalog = generateToolCatalogTypeScript([minimalTool], "HealthCatalog");
      expect(catalog).toContain('export interface HealthCatalogMap {\n  "ping": PingArgs;\n}');
      expect(catalog).toContain("export type HealthCatalogName = keyof HealthCatalogMap;");
    });

    it("preserves boolean defaults, numeric enums, and constraints in roundtrip", () => {
      const originalSchema: JsonSchemaDocument = {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        title: "DeployAppArgs",
        description: "Deploys an application cluster",
        required: ["environment", "replicas"],
        properties: {
          environment: {
            type: "string",
            description: "Deployment environment",
            enum: ["dev", "staging", "prod"],
          },
          replicas: {
            type: "integer",
            description: "Replica count",
            minimum: 1,
            maximum: 100,
            default: 3,
          },
          force: {
            type: "boolean",
            description: "Force roll deployment",
            default: false,
          },
        },
      };

      const tool = jsonSchemaToToolDefinition(originalSchema, "deploy_app", "infra");
      expect(tool.name).toBe("deploy_app");
      expect(tool.category).toBe("infra");
      expect(tool.parameters).toHaveLength(3);

      const envParam = tool.parameters.find((p) => p.name === "environment")!;
      expect(envParam.required).toBe(true);
      expect(envParam.enumValues).toEqual(["dev", "staging", "prod"]);

      const replicasParam = tool.parameters.find((p) => p.name === "replicas")!;
      expect(replicasParam.required).toBe(true);
      expect(replicasParam.type).toBe("number");
      expect(replicasParam.integer).toBe(true);
      expect(replicasParam.minimum).toBe(1);
      expect(replicasParam.maximum).toBe(100);
      expect(replicasParam.defaultValue).toBe(3);

      const forceParam = tool.parameters.find((p) => p.name === "force")!;
      expect(forceParam.required).toBe(false);
      expect(forceParam.type).toBe("boolean");
      expect(forceParam.defaultValue).toBe(false);

      const regeneratedSchema = toolDefinitionToJsonSchema(tool);
      expect(regeneratedSchema.title).toBe("DeployAppArgs");
      expect(regeneratedSchema.required).toEqual(["environment", "replicas"]);
      expect(regeneratedSchema.properties.environment.enum).toEqual(["dev", "staging", "prod"]);
      expect(regeneratedSchema.properties.replicas.default).toBe(3);
      expect(regeneratedSchema.properties.force.default).toBe(false);
    });
  });
});
