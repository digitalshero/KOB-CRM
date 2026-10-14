import fs from "fs";
import path from "path";
import ts from "typescript";

const BASE_DIR = "d:/Shero Home Food/kob-unity-spark (2)";
const SRC_DIR = path.join(BASE_DIR, "src");

function getAllFiles(dir, exts = [".ts", ".tsx"]) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, exts));
    } else if (exts.includes(path.extname(file))) {
      results.push(fullPath);
    }
  }
  return results;
}

const targetDirs = [
  path.join(SRC_DIR, "routes"),
  path.join(SRC_DIR, "components"),
  path.join(SRC_DIR, "hooks"),
  path.join(SRC_DIR, "lib"),
];

let allFiles = [];
for (const d of targetDirs) {
  if (fs.existsSync(d)) {
    allFiles = allFiles.concat(getAllFiles(d));
  }
}

const apiClientCalls = [];

for (const filePath of allFiles) {
  const relPath = path.relative(BASE_DIR, filePath).replace(/\\/g, "/");
  const code = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      // apiClient.get(...), apiClient.post(...), etc.
      if (
        ts.isPropertyAccessExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === "apiClient"
      ) {
        const method = expr.name.text.toUpperCase();
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        let endpoint = "UNKNOWN";
        if (node.arguments.length > 0) {
          const arg0 = node.arguments[0];
          if (ts.isStringLiteral(arg0)) {
            endpoint = arg0.text;
          } else if (ts.isTemplateExpression(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0)) {
            endpoint = arg0.getText();
          } else {
            endpoint = arg0.getText();
          }
        }
        apiClientCalls.push({
          file: relPath,
          line,
          method,
          endpoint,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

fs.writeFileSync(
  path.join(BASE_DIR, "backend/scratch/api_client_calls.json"),
  JSON.stringify(apiClientCalls, null, 2)
);

console.log("Total apiClient calls in frontend:", apiClientCalls.length);

// Extract distinct normalized routes
const distinctEndpoints = new Set();
apiClientCalls.forEach((c) => distinctEndpoints.add(`${c.method} ${c.endpoint.split("?")[0].replace(/[`'"]/g, "")}`));
console.log("Distinct endpoints called:", distinctEndpoints.size);
for (const ep of Array.from(distinctEndpoints).sort()) {
  console.log("  ", ep);
}
