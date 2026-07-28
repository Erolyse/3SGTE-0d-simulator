import {
    existsSync,
    readFileSync,
    readdirSync
} from "node:fs";
import {
    dirname,
    extname,
    relative,
    resolve
} from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const SEARCH_ROOTS = [
    resolve(ROOT, "assets", "simulator"),
    resolve(ROOT, "tests")
];

function collectFiles(directory, output = []) {
    if (!existsSync(directory)) return output;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            collectFiles(path, output);
        } else if (entry.isFile() && [".js", ".mjs"].includes(extname(entry.name))) {
            output.push(path);
        }
    }
    return output;
}

function extractSpecifiers(source) {
    const specifiers = new Set();
    const patterns = [
        /\bimport\s+(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g,
        /\bexport\s+[^;"']*?\s+from\s+["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            specifiers.add(match[1]);
        }
    }
    return [...specifiers];
}

function resolveRelativeImport(importer, specifier) {
    const direct = resolve(dirname(importer), specifier);
    const candidates = [
        direct,
        `${direct}.js`,
        `${direct}.mjs`,
        resolve(direct, "index.js"),
        resolve(direct, "index.mjs")
    ];
    return candidates.find(existsSync) ?? null;
}

const files = SEARCH_ROOTS.flatMap(directory => collectFiles(directory));
const uniqueFiles = [...new Set(files)].sort();
const failures = [];
let checkedImports = 0;

for (const file of uniqueFiles) {
    const source = readFileSync(file, "utf8");
    for (const specifier of extractSpecifiers(source)) {
        if (!specifier.startsWith(".")) continue;
        checkedImports++;
        const resolved = resolveRelativeImport(file, specifier);
        if (!resolved) {
            failures.push({
                importer: relative(ROOT, file),
                specifier
            });
        }
    }
}

if (failures.length > 0) {
    for (const failure of failures) {
        console.error(`FAIL import · ${failure.importer} -> ${failure.specifier}`);
    }
    console.error(`RESULT imports · ${failures.length} import(s) relatif(s) introuvable(s)`);
    process.exit(1);
}

console.log(`PASS imports · ${checkedImports} import(s) relatif(s) résolus`);
