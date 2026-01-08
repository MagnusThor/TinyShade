import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "glob";
import path from "node:path";
import { writeFile, unlink } from "node:fs/promises";

const execFileAsync = promisify(execFile);

// 1. Configuration for the CLI
const minirayCli = "node";
const minirayArgs = ["node_modules/miniray/bin/miniray"];

// 2. Minifier Options
const config = {
    "minifyWhitespace": true,
    "minifyIdentifiers": true,
    "minifySyntax": true,
    "mangleExternalBindings": false,
    "preserveUniformStructTypes": true,
    "keepNames": ["Uniforms", "u"," ##WORKGROUP_SIZE"]
};

// 3. Main Execution
const runMinifier = async () => {
    // A. Create a temporary config file on disk
    const tempConfigPath = path.join(process.cwd(), "miniray.config.tmp.json");
    await writeFile(tempConfigPath, JSON.stringify(config));

    // B. Find all WGSL files
    const files = await glob("src/**/*.wgsl", {
        ignore: "**/*.min.wgsl",
    });

    console.log(`🚀 Starting WGSL minification for ${files.length} files...`);

    try {
        for (const file of files) {
            const out = file.replace(/\.wgsl$/, ".min.wgsl");

            try {
                // C. Pass the PATH to the temp file, not the JSON string
                await execFileAsync(minirayCli, [
                    ...minirayArgs,
                    file,
                    "--config", tempConfigPath,
                    "-o", out,
                ]);
                console.log(`  ✓ ${path.relative(process.cwd(), out)}`);
            } catch (error) {
                console.error(`  ✕ Error minifying ${file}:`, error.stderr || error.message);
            }
        }
    } finally {
        // D. Clean up: Delete the temp config file when done
        await unlink(tempConfigPath);
        console.log("✨ Minification complete and temporary config removed.");
    }
};

runMinifier();