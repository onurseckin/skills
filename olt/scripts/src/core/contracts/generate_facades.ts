import * as fs from "fs";
import * as path from "path";

const domains = ["git", "agents", "system", "network"];
const baseDir = "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/core/contracts";

for (const domain of domains) {
  const dir = path.join(baseDir, domain);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  let indexContent = "";

  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const exports: string[] = [];
    const typeExports: string[] = [];

    const lines = content.split("\n");
    for (const line of lines) {
      const match = line.match(/^export (type|interface|const|function) ([a-zA-Z0-9_]+)/);
      if (match && match[2]) {
        if (match[1] === "type" || match[1] === "interface") {
          typeExports.push(match[2]);
        } else {
          exports.push(match[2]);
        }
      }
    }

    if (typeExports.length > 0 || exports.length > 0) {
      const allExports = [...typeExports.map((t) => `type ${t}`), ...exports];
      indexContent += `export { ${allExports.join(", ")} } from "./${file.replace(".ts", ".js")}";\n`;
    }
  }

  fs.writeFileSync(path.join(dir, "index.ts"), indexContent);
}
