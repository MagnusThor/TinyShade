const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");
const glob = require("glob");

function getEntries() {
    const files = glob.sync("./src/example/*.ts");
    const entries = {};
    files.forEach(file => {
        const name = path.basename(file, ".ts");
        entries[name] = path.resolve(__dirname, file);
    });
    return entries;
}

module.exports = (env, argv) => {
    const isProduction = argv.mode === "production";

    return {
        mode: isProduction ? "production" : "development",
        devtool: isProduction ? false : "eval-source-map",

        entry: getEntries(),

        output: {
            path: path.resolve(__dirname, "public/js"),
            filename: "[name]-bundle.js",
            publicPath: "/js/",
            clean: true,
        },

        devServer: {
            static: path.join(__dirname, "public"),
            compress: true,
            port: 3000,
            hot: true,
            open: true,
            historyApiFallback: true,
            devMiddleware: {
                writeToDisk: false,
            },
        },

        resolve: {
            extensions: [".ts", ".js"],
        },

        module: {
            rules: [
                // TypeScript
                {
                    test: /\.ts$/,
                    use: "ts-loader",
                    exclude: /node_modules/,
                },
                // WGSL shaders
                {
                    test: /\.wgsl$/,
                    type: "asset/source", // inlines WGSL as string
                },
                {
                    resourceQuery: /raw/,
                    type: 'asset/source',
                },
            ],
        },

        optimization: {
            minimize: isProduction,
            minimizer: [
                new TerserPlugin({
                    terserOptions: {
                        format: { comments: false },
                        mangle: { toplevel: false },
                        compress: { drop_console: isProduction, passes: 2 },
                    },
                }),
            ],
        },
    };
};
