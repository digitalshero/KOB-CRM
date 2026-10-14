import fs from "fs";
import path from "path";
import ts from "typescript";

const BASE_DIR = "d:/Shero Home Food/kob-unity-spark (2)";
const SRC_DIR = path.join(BASE_DIR, "src");

const inventory = JSON.parse(
  fs.readFileSync(
    "C:/Users/acer/.gemini/antigravity-ide/brain/906bf449-3a77-4ccc-bbf4-97cc38a846f1/scratch/ast_inventory.json",
    "utf8"
  )
);
const functionMap = new Map();
inventory.forEach((fn) => functionMap.set(fn.name, fn));

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

const fileAudits = [];

for (const filePath of allFiles) {
  const relPath = path.relative(BASE_DIR, filePath).replace(/\\/g, "/");
  const code = fs.readFileSync(filePath, "utf8");
  const isServerFile = relPath.endsWith(".functions.ts") || relPath.endsWith(".server.ts");

  const sourceFile = ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.Latest,
    true
  );

  const fileAudit = {
    file: relPath,
    isServerFile,
    importsReactStart: false,
    importedReactStartSymbols: [],
    importsCreateServerFn: false,
    importsUseServerFn: false,
    serverFunctionImports: [],
    useServerFnCalls: [],
    invocations: {},
    allIdentifiers: {},
  };

  // Pass 1: imports
  function visit1(node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

      if (moduleSpecifier === "@tanstack/react-start") {
        fileAudit.importsReactStart = true;
        if (node.importClause && node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const el of node.importClause.namedBindings.elements) {
            const sym = el.name.text;
            fileAudit.importedReactStartSymbols.push({ sym, line });
            if (sym === "useServerFn") fileAudit.importsUseServerFn = true;
            if (sym === "createServerFn") fileAudit.importsCreateServerFn = true;
          }
        }
      }

      if (
        moduleSpecifier.includes(".functions") ||
        moduleSpecifier.includes(".server") ||
        moduleSpecifier.includes("/lib/kob") ||
        moduleSpecifier.includes("/lib/qa") ||
        moduleSpecifier.includes("/lib/webinar") ||
        moduleSpecifier.includes("/lib/evaluation") ||
        moduleSpecifier.includes("/lib/meta-ads") ||
        moduleSpecifier.includes("/lib/import-leads") ||
        moduleSpecifier.includes("/lib/seed-users")
      ) {
        if (node.importClause && node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const el of node.importClause.namedBindings.elements) {
            const name = el.name.text;
            const propertyName = el.propertyName ? el.propertyName.text : name;
            fileAudit.serverFunctionImports.push({
              importedName: propertyName,
              localName: name,
              from: moduleSpecifier,
              line,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit1);
  }
  visit1(sourceFile);

  // Pass 2: calls and identifiers
  function visit2(node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr) && expr.text === "useServerFn") {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        let fnArg = null;
        if (node.arguments.length > 0 && ts.isIdentifier(node.arguments[0])) {
          fnArg = node.arguments[0].text;
        }

        // Walk up parents through AsExpression or ParenthesizedExpression
        let parent = node.parent;
        while (parent && (ts.isAsExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isTypeAssertionExpression(parent))) {
          parent = parent.parent;
        }

        let boundVar = null;
        let isInlineQueryFn = false;

        if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
          boundVar = parent.name.text;
        } else if (parent && ts.isPropertyAssignment(parent)) {
          boundVar = `inline_prop_${parent.name.getText()}`;
          if (parent.name.getText() === "queryFn") {
            isInlineQueryFn = true;
          }
        }

        fileAudit.useServerFnCalls.push({
          line,
          fnArg,
          boundVar,
          isInlineQueryFn,
        });
      }
    }

    if (ts.isIdentifier(node)) {
      const name = node.text;
      fileAudit.allIdentifiers[name] = (fileAudit.allIdentifiers[name] || 0) + 1;

      // Check if this identifier is being invoked: foo(...)
      const parent = node.parent;
      if (ts.isCallExpression(parent) && parent.expression === node) {
        fileAudit.invocations[name] = (fileAudit.invocations[name] || 0) + 1;
      }
    }

    ts.forEachChild(node, visit2);
  }
  visit2(sourceFile);

  fileAudits.push(fileAudit);
}

fs.writeFileSync(
  path.join(BASE_DIR, "backend/scratch/ast_full_audit_raw.json"),
  JSON.stringify(fileAudits, null, 2)
);

console.log("AST audit raw scan updated. Total files:", fileAudits.length);
