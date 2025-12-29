/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./build/example/singepass-app.js":
/*!****************************************!*\
  !*** ./build/example/singepass-app.js ***!
  \****************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

eval("\nObject.defineProperty(exports, \"__esModule\", ({ value: true }));\nconst TinyShade_1 = __webpack_require__(Object(function webpackMissingModule() { var e = new Error(\"Cannot find module '../TinyShade'\"); e.code = 'MODULE_NOT_FOUND'; throw e; }()));\ndocument.addEventListener(\"DOMContentLoaded\", async () => {\n    const app = await TinyShade_1.TinyShade.create(\"canvas\");\n    (await app.setUniforms().addPass(`\r\n        // Helper functions injected into the pass\r\n        fn hash22(p: vec2f) -> vec2f {\r\n            var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));\r\n            p3 += dot(p3, p3.yzx + 33.33);\r\n            return fract((p3.xx + p3.yz) * p3.zy);\r\n        }\r\n\r\n        fn rotate2D(r: f32) -> mat2x2f {\r\n            let c = cos(r); let s = sin(r);\r\n            return mat2x2f(c, s, -s, c);\r\n        }\r\n\r\n        @fragment \r\n        fn main(in: VSOut) -> @location(0) vec4f {\r\n            let res = u.resolution.xy;\r\n            let uv = (in.pos.xy - 0.5 * res) / res.y;\r\n\r\n            var p = uv;\r\n            var n = vec2f(0.0);\r\n            var warp_accum = 0.0;\r\n            let m = rotate2D(5.0);\r\n            \r\n            // 1. Warping Layer\r\n            for (var j: f32 = 0.0; j < 6.0; j += 1.0) {\r\n                p = m * p;\r\n                n = m * n;\r\n                let q = p * 1.5 + u.time * 0.5 + n;\r\n                warp_accum += dot(cos(q), vec2f(0.2));\r\n                n -= sin(q);\r\n            }\r\n\r\n            // 2. Cellular / Voronoi Logic\r\n            let cell_uv = uv * 8.0 + n; \r\n            let i_p = floor(cell_uv);\r\n            let f_p = fract(cell_uv);\r\n            \r\n            var min_dist: f32 = 1.0;\r\n            for (var y: f32 = -1.0; y <= 1.0; y += 1.0) {\r\n                for (var x: f32 = -1.0; x <= 1.0; x += 1.0) {\r\n                    let neighbor = vec2f(x, y);\r\n                    var point = hash22(i_p + neighbor);\r\n                    point = 0.5 + 0.5 * sin(u.time + 6.28 * point);\r\n                    let dist = length(neighbor + point - f_p);\r\n                    min_dist = min(min_dist, dist);\r\n                }\r\n            }\r\n\r\n            // 3. Coloring\r\n            let blood_red = vec3f(0.4, 0.02, 0.05);\r\n            let cell_color = vec3f(1.0, 0.7, 0.6);\r\n            \r\n            let membrane = smoothstep(0.4, 0.1, min_dist);\r\n            let glow = (1.0 - min_dist) * warp_accum;\r\n            \r\n            var final_rgb = mix(blood_red, cell_color, membrane);\r\n            final_rgb += glow * vec3f(0.8, 0.2, 0.1);\r\n            \r\n            // Subtle Vignette in-pass\r\n            final_rgb *= 1.2 - dot(uv, uv);\r\n\r\n            return vec4f(final_rgb, 1.0);\r\n        }\r\n    `)\n        .main(`\r\n        @fragment \r\n        fn main(in: VSOut) -> @location(0) vec4f {\r\n            let uv = in.uv;\r\n            \r\n            let fin = textureSample(pass0, samp, uv).rgb;\r\n          \r\n            return vec4f(fin, 1.0);\r\n        }\r\n    `))\n        .run();\n});\n\n\n//# sourceURL=webpack://tinyshade/./build/example/singepass-app.js?");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module can't be inlined because the eval devtool is used.
/******/ 	var __webpack_exports__ = __webpack_require__("./build/example/singepass-app.js");
/******/ 	
/******/ })()
;