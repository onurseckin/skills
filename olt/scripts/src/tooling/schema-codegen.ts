import type {
  CodegenOptions,
  JsonSchemaDocument,
  JsonSchemaProperty,
  ToolDefinition,
  ToolParameter,
  ToolParameterSchema,
  ToolParameterType,
} from "./types.ts";

export function toCamelCase(str: string): string {
  return str
    .replace(/[-_ ]+(\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^\w/, (c: string) => c.toLowerCase());
}

export function toPascalCase(str: string): string {
  return str
    .replace(/[-_ ]+(\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^\w/, (c: string) => c.toUpperCase());
}

export function toolParameterToJsonSchemaProperty(param: ToolParameter): JsonSchemaProperty {
  const prop: JsonSchemaProperty = {
    type: param.type === "integer" ? "integer" : param.type,
    ...(param.description ? { description: param.description } : {}),
  };

  if (param.defaultValue !== undefined) prop.default = param.defaultValue;
  if (param.enumValues && param.enumValues.length > 0) prop.enum = param.enumValues;
  if (param.pattern) prop.pattern = param.pattern;
  if (param.minLength !== undefined) prop.minLength = param.minLength;
  if (param.maxLength !== undefined) prop.maxLength = param.maxLength;
  if (param.minimum !== undefined) prop.minimum = param.minimum;
  if (param.maximum !== undefined) prop.maximum = param.maximum;

  if (param.type === "array" && param.itemType) {
    const itemTypeStr =
      typeof param.itemType === "string" ? param.itemType : param.itemType.type;
    prop.items = { type: itemTypeStr };
  }

  if (param.type === "object" && param.properties) {
    const propsList: readonly (ToolParameter | ToolParameterSchema)[] = Array.isArray(param.properties)
      ? (param.properties as readonly (ToolParameter | ToolParameterSchema)[])
      : Object.entries(param.properties).map(([name, p]) => ({
          name,
          type: p.type as ToolParameterType,
          description: p.description ?? "",
          required: p.required,
          defaultValue: p.defaultValue,
          enumValues: p.enumValues,
        }));
    if (propsList.length > 0) {
      const nestedProps: Record<string, JsonSchemaProperty> = {};
      const nestedRequired: string[] = [];
      for (const nestedParam of propsList) {
        nestedProps[nestedParam.name] = toolParameterToJsonSchemaProperty(nestedParam as ToolParameter);
        if (nestedParam.required) nestedRequired.push(nestedParam.name);
      }
      prop.properties = nestedProps;
      if (nestedRequired.length > 0) prop.required = nestedRequired;
    }
  }

  return prop;
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
    required: required.length > 0 ? required : undefined,
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

  let itemType: string | undefined;
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
  const parameters: ToolParameter[] = Object.entries(schema.properties).map(
    ([propName, propSchema]) =>
      jsonSchemaPropertyToToolParameter(propName, propSchema, reqSet.has(propName)),
  );

  return {
    name,
    description: schema.description ?? "",
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
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array": {
      const iType = typeof param.itemType === "string" ? param.itemType : "unknown";
      return `${iType}[]`;
    }
    case "object": {
      if (param.properties) {
        const propsList: readonly (ToolParameter | ToolParameterSchema)[] = Array.isArray(param.properties)
          ? (param.properties as readonly (ToolParameter | ToolParameterSchema)[])
          : Object.entries(param.properties).map(([name, p]) => ({
              name,
              type: p.type as ToolParameterType,
              description: p.description ?? "",
              required: p.required,
            }));
        if (propsList.length > 0) {
          const fields = propsList
            .map((p) => `  ${p.name}${p.required ? "" : "?"}: ${parameterToTypeScriptType(p as ToolParameter)};`)
            .join("\n");
          return `{\n${fields}\n}`;
        }
      }
      return "Record<string, unknown>";
    }
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
  options?: CodegenOptions & { readonly includeHandler?: boolean; readonly includeHandlerSignature?: boolean },
): string {
  const typeName = `${toPascalCase(tool.name)}Args`;
  const exportKind = options?.exportType ?? "interface";
  const fields = toolParametersToTypeScriptFields(tool.parameters);

  let output = "";
  if (exportKind === "interface") {
    output = `export interface ${typeName} {\n${fields}\n}`;
  } else {
    output = `export type ${typeName} = {\n${fields}\n};`;
  }

  if (options?.includeHandler || options?.includeHandlerSignature) {
    const resultTypeName = `${toPascalCase(tool.name)}Result`;
    output += `\n\nexport type ${resultTypeName} = unknown;`;
    output += `\n\nexport type ${toPascalCase(tool.name)}Handler = (args: ${typeName}) => Promise<${resultTypeName}> | ${resultTypeName};`;
  }

  return output;
}

export function generateToolCatalogTypeScript(
  tools: readonly ToolDefinition[],
  catalogName = "ToolCatalog",
): string {
  const definitions = tools
    .map((t) => toolDefinitionToTypeScript(t, { includeHandlerSignature: true }))
    .join("\n\n");
  const mapEntries = tools
    .map((t) => `  "${t.name}": ${toPascalCase(t.name)}Args;`)
    .join("\n");
  const catalogMap = `export interface ${catalogName}Map {\n${mapEntries}\n}\n\nexport type ${catalogName}Name = keyof ${catalogName}Map;`;
  return `${definitions}\n\n${catalogMap}`;
}
