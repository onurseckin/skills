import type {
  CodegenOptions,
  JsonSchemaDocument,
  JsonSchemaProperty,
  ToolDefinition,
  ToolParameter,
  ToolParameterType,
} from "./types.ts";

export function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => (chr as string).toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toolParameterToJsonSchemaProperty(param: ToolParameter): JsonSchemaProperty {
  const prop: Record<string, unknown> = {
    type: param.type,
    description: param.description,
  };

  if (param.defaultValue !== undefined) prop.default = param.defaultValue;
  if (param.enumValues && param.enumValues.length > 0) prop.enum = param.enumValues;
  if (param.pattern) prop.pattern = param.pattern;
  if (param.minLength !== undefined) prop.minLength = param.minLength;
  if (param.maxLength !== undefined) prop.maxLength = param.maxLength;
  if (param.minimum !== undefined) prop.minimum = param.minimum;
  if (param.maximum !== undefined) prop.maximum = param.maximum;

  if (param.type === "array" && param.itemType) {
    prop.items = { type: param.itemType };
  }

  if (param.type === "object" && param.properties && param.properties.length > 0) {
    const nestedProps: Record<string, JsonSchemaProperty> = {};
    const nestedRequired: string[] = [];
    for (const nestedParam of param.properties) {
      nestedProps[nestedParam.name] = toolParameterToJsonSchemaProperty(nestedParam);
      if (nestedParam.required) nestedRequired.push(nestedParam.name);
    }
    prop.properties = nestedProps;
    if (nestedRequired.length > 0) prop.required = nestedRequired;
  }

  return prop as JsonSchemaProperty;
}

export function toolDefinitionToJsonSchema(
  tool: ToolDefinition,
  options?: { readonly schemaDraft?: string; readonly additionalProperties?: boolean },
): JsonSchemaDocument {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const param of tool.parameters) {
    properties[param.name] = toolParameterToJsonSchemaProperty(param);
    if (param.required) required.push(param.name);
  }

  return {
    $schema: options?.schemaDraft ?? "http://json-schema.org/draft-07/schema#",
    type: "object",
    title: `${toPascalCase(tool.name)}Args`,
    description: tool.description,
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: options?.additionalProperties ?? false,
  };
}

export function jsonSchemaPropertyToToolParameter(
  name: string,
  prop: JsonSchemaProperty,
  required = false,
): ToolParameter {
  let paramType: ToolParameterType = "string";
  const rawType = Array.isArray(prop.type) ? prop.type[0] : prop.type;

  if (rawType === "number" || rawType === "integer") paramType = "number";
  else if (rawType === "boolean") paramType = "boolean";
  else if (rawType === "object") paramType = "object";
  else if (rawType === "array") paramType = "array";
  else paramType = "string";

  let itemType: ToolParameterType | undefined;
  if (prop.items && typeof prop.items === "object") {
    const rawItemType = Array.isArray(prop.items.type) ? prop.items.type[0] : prop.items.type;
    if (rawItemType === "number" || rawItemType === "integer") itemType = "number";
    else if (rawItemType === "boolean") itemType = "boolean";
    else if (rawItemType === "object") itemType = "object";
    else if (rawItemType === "array") itemType = "array";
    else if (rawItemType === "string") itemType = "string";
  }

  let nestedParams: ToolParameter[] | undefined;
  if (prop.properties) {
    const reqSet = new Set(prop.required ?? []);
    nestedParams = Object.entries(prop.properties).map(([nestedKey, nestedProp]) =>
      jsonSchemaPropertyToToolParameter(nestedKey, nestedProp, reqSet.has(nestedKey)),
    );
  }

  return {
    name,
    type: paramType,
    description: prop.description ?? "",
    required,
    defaultValue: prop.default,
    enumValues: prop.enum,
    pattern: prop.pattern,
    minLength: prop.minLength,
    maxLength: prop.maxLength,
    minimum: prop.minimum,
    maximum: prop.maximum,
    integer: rawType === "integer",
    itemType,
    properties: nestedParams,
  };
}

export function jsonSchemaToToolDefinition(
  schema: JsonSchemaDocument,
  name = "dynamic_tool",
  category = "generated",
): ToolDefinition {
  const reqSet = new Set(schema.required ?? []);
  const parameters: ToolParameter[] = Object.entries(schema.properties || {}).map(
    ([key, prop]) => jsonSchemaPropertyToToolParameter(key, prop, reqSet.has(key)),
  );

  return {
    name,
    description: schema.description ?? schema.title ?? name,
    category,
    parameters,
    enabled: true,
  };
}

function parameterToTypeScriptType(param: ToolParameter): string {
  if (param.enumValues && param.enumValues.length > 0) {
    return param.enumValues.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(" | ");
  }
  switch (param.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return param.itemType ? `${param.itemType}[]` : "unknown[]";
    case "object":
      if (param.properties && param.properties.length > 0) {
        const fields = param.properties
          .map((p) => `  ${p.name}${p.required ? "" : "?"}: ${parameterToTypeScriptType(p)};`)
          .join("\n");
        return `{\n${fields}\n}`;
      }
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}

export function toolParametersToTypeScriptFields(
  params: readonly ToolParameter[],
  indent = "  ",
): string {
  return params
    .map((p) => {
      const opt = p.required ? "" : "?";
      const tsType = parameterToTypeScriptType(p);
      return `${indent}${p.name}${opt}: ${tsType};`;
    })
    .join("\n");
}

export function toolDefinitionToTypeScript(
  tool: ToolDefinition,
  options: CodegenOptions = {},
): string {
  const pascalName = toPascalCase(tool.name);
  const typeKeyword = options.exportType === "type" ? "type" : "interface";
  const fields = toolParametersToTypeScriptFields(tool.parameters, "  ");

  let code = "";
  if (typeKeyword === "interface") {
    code += `export interface ${pascalName}Args {\n${fields}\n}\n`;
  } else {
    code += `export type ${pascalName}Args = {\n${fields}\n};\n`;
  }

  if (options.includeHandlerSignature) {
    code += `\nexport type ${pascalName}Handler = (args: ${pascalName}Args, context?: import("./types.ts").ToolContext) => Promise<unknown> | unknown;\n`;
  }

  return code;
}

export function generateToolCatalogTypeScript(
  tools: readonly ToolDefinition[],
  moduleName = "ToolCatalog",
): string {
  const interfaces = tools.map((t) => toolDefinitionToTypeScript(t)).join("\n");
  const toolMapEntries = tools
    .map((t) => `  "${t.name}": ${toPascalCase(t.name)}Args;`)
    .join("\n");

  return `${interfaces}
export interface ${toPascalCase(moduleName)}Map {
${toolMapEntries}
}

export type ${toPascalCase(moduleName)}Name = keyof ${toPascalCase(moduleName)}Map;
`;
}
