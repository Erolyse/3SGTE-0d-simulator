import { readdirSync, statSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const SEARCH_ROOTS = [
    resolve(ROOT, "assets", "simulator"),
    resolve(ROOT, "tests")
];

function collectFiles(directory, output = []) {
    try {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                collectFiles(path, output);
                continue;
            }
            if (entry.isFile() && [".js", ".mjs"].includes(extname(entry.name))) {
                output.push(path);
            }
        }
    } catch (error) {
        if (error?.code !== "ENOENT") throw error;
    }
    return output;
}

const files = SEARCH_ROOTS.flatMap(directory => collectFiles(directory));
const uniqueFiles = [...new Set(files)].sort();

if (!statSync(resolve(ROOT, "assets", "simulator"), { throwIfNoEntry: false })) {
    console.error("FAIL syntax · dossier assets/simulator introuvable");
    process.exit(1);
}

let failures = 0;
for (const file of uniqueFiles) {
    const result = spawnSync(process.execPath, ["--check", file], {
        cwd: ROOT,
        encoding: "utf8"
    });
    if (result.status !== 0) {
        failures++;
        console.error(`FAIL syntax · ${relative(ROOT, file)}`);
        if (result.stderr) console.error(result.stderr.trim());
    }
}

if (failures > 0) {
    console.error(`RESULT syntax · ${failures} fichier(s) invalide(s) sur ${uniqueFiles.length}`);
    process.exit(1);
}

console.log(`PASS syntax · ${uniqueFiles.length} fichier(s) JavaScript valides`);
