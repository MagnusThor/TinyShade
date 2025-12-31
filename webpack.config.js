const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = (env, argv) => {
    const isProduction = argv.mode === 'production';

    return {
        mode: isProduction ? "production" : "development",

        devtool: isProduction ? false : "eval-source-map",

        entry: {
            "example1": "/build/example/example1.js",
            "example2": "/build/example/example2.js",
            "example3": "/build/example/example3.js",
            "example4": "/build/example/example4.js",
            "example5": "/build/example/example5.js",
            "example6": "/build/example/example6.js",
            "example7": "/build/example/example7.js",
            "example8": "/build/example/example8.js",
            "example9": "/build/example/example9.js",
            "example10": "/build/example/example10.js"
        },

        output: {
            path: path.resolve(__dirname, "public/js/"),
            filename: "[name]-bundle.js",
            publicPath: "/js/" 
        },

        devServer: {
            static: {
                directory: path.join(__dirname, "public"),
            },
            compress: true,
            port: 3000,
            hot: true,
            open: true,
            historyApiFallback: true,
        },

        module: {
            rules: []
        },

        externals: {},

        optimization: {
            minimize: isProduction,
            minimizer: [
                new TerserPlugin({
                    terserOptions: {
                        format: {
                            comments: false,
                        },
                        mangle: {
                            toplevel: true,
                        },
                        compress: {
                            drop_console: isProduction,
                            passes: 2
                        }
                    },
                }),
            ],
        }
    };
};