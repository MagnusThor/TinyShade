import { MinifyOptions, minify as jsMinify } from "terser";

/**
 * Minifies JavaScript source code.
 *
 * Wraps the underlying JS minifier and applies a default
 * configuration when none is provided.
 *
 * @param code - JavaScript source code to minify
 * @param config - Optional minifier configuration options
 * @returns Minified code and associated metadata (e.g. source map)
 */
export const minifyJS = async (
    code: string,
    config?: MinifyOptions
) => {
    return await jsMinify(cleanForBaking(code), config || { sourceMap: true });
};


/**
 * Cleans a stringified class of CommonJS boilerplate
 * so it can run directly in a <script> tag.
 */
function cleanForBaking(code:string) {
    return code
        .replace(/"use strict";/g, "")
        .replace(/Object\.defineProperty\(exports,.*?\);/g, "")
        .replace(/exports\..*?\s*=\s*/g, "")
        .replace(/void 0;/g, "")
        // Optional: Remove comments to save space in the Bake
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "") 
        .trim();
}