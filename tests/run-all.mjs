import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const tasks = [
    ["Syntaxe JavaScript", "tests/check-syntax.mjs"],
    ["Graphe des imports", "tests/check-imports.mjs"],
    ["Tests unitaires des sous-modules", "tests/submodules.test.mjs"],
    ["Tests transitoires", "tests/transients.test.mjs"]
];

console.log("3S-GTE 0D · campagne de vérification standalone\n");
const suiteStart = performance.now();

for (const [label, script] of tasks) {
    console.log(`\n=== ${label} ===`);
    const start = performance.now();
    const result = spawnSync(process.execPath, [script], {
        cwd: ROOT,
        stdio: "inherit"
    });
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);

    if (result.error) {
        console.error(`\nFAIL ${label} · ${result.error.message}`);
        process.exit(1);
    }
    if (result.status !== 0) {
        console.error(`\nFAIL ${label} · code de sortie ${result.status} · ${elapsed} s`);
        process.exit(result.status ?? 1);
    }
    console.log(`PASS ${label} · ${elapsed} s`);
}

const total = ((performance.now() - suiteStart) / 1000).toFixed(2);
console.log(`\n============================================`);
console.log(`RESULT GLOBAL · PASS · ${tasks.length}/${tasks.length} familles validées · ${total} s`);
console.log(`============================================`);
