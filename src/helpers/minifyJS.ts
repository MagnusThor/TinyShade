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
    return await jsMinify(code, config || { sourceMap: true });
};
