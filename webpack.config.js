

module.exports = {
    mode: "development",
    watch: false,
    entry: {
        "particles": "/build/example/particles-app.js",
        "particles-dof": "/build/example/particles-dof-app.js",
        "prev-pass": "/build/example/prev-pass.js",
        "singepass":"/build/example/singepass-app.js",
        "compute":"/build/example/compute.js"

    },
    output: {
        path: __dirname + "/public/js/",
        filename: "[name]-bundle.js"
    },
    plugins: [
    ],
    module: {
        rules: [
        ]
    },
    externals: {
    }

}