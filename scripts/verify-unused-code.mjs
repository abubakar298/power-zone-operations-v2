// Fails when code adds an import, variable or function that nothing uses.
//
// It runs TypeScript's own "unused" check (noUnusedLocals) over the app,
// server and tools/tests projects. Items that are unused today on purpose
// are listed in scripts/unused-code-allowlist.json (file -> names). Anything
// new that is not on that list fails the check.
//
//   node scripts/verify-unused-code.mjs           check
//   node scripts/verify-unused-code.mjs --update  rewrite the list to today's findings
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const listPath = path.join(root, "scripts", "unused-code-allowlist.json");
const projects = ["tsconfig.app.json", "tsconfig.server.json", "tsconfig.tools.json"];
// 6133: declared but never read. 6192: all imports unused.
// 6196: declared but never used (types). 6198: all destructured items unused.
const unusedCodes = new Set([6133, 6192, 6196, 6198]);

function findUnused() {
  const seen = new Set();
  const found = {};
  for (const project of projects) {
    const config = ts.readConfigFile(path.join(root, project), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const options = { ...parsed.options, noUnusedLocals: true, noEmit: true };
    const program = ts.createProgram(parsed.fileNames, options);
    for (const d of ts.getPreEmitDiagnostics(program)) {
      if (!unusedCodes.has(d.code) || !d.file) continue;
      const file = path.relative(root, d.file.fileName).replaceAll("\\", "/");
      if (file.startsWith("node_modules/")) continue;
      const where = `${file}:${d.start}`;
      if (seen.has(where)) continue; // the same file can be in two projects
      seen.add(where);
      const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
      const name = message.match(/^'([^']+)'/)?.[1] ?? message.replace(/\.$/, "");
      (found[file] ??= []).push(name);
    }
  }
  for (const names of Object.values(found)) names.sort();
  return Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)));
}

const found = findUnused();

if (process.argv.includes("--update")) {
  writeFileSync(listPath, JSON.stringify(found, null, 2) + "\n");
  const total = Object.values(found).reduce((n, names) => n + names.length, 0);
  console.log(`Unused-code list rewritten: ${total} kept-on-purpose items.`);
  process.exit(0);
}

const allowed = JSON.parse(readFileSync(listPath, "utf8"));
const count = (names) => names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map());
const added = [];
const gone = [];
for (const file of new Set([...Object.keys(found), ...Object.keys(allowed)])) {
  const now = count(found[file] ?? []);
  const before = count(allowed[file] ?? []);
  for (const [name, n] of now) if (n > (before.get(name) ?? 0)) added.push(`${file}: ${name}`);
  for (const [name, n] of before) if (n > (now.get(name) ?? 0)) gone.push(`${file}: ${name}`);
}

if (gone.length) {
  console.log("These kept-on-purpose items are no longer unused; remove them from scripts/unused-code-allowlist.json:");
  for (const item of gone) console.log("  " + item);
}
if (added.length) {
  console.error("New unused code found. Remove it, or if it must stay, add it to scripts/unused-code-allowlist.json:");
  for (const item of added) console.error("  " + item);
  process.exit(1);
}
console.log("No new unused code.");
