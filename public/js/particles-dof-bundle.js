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

/***/ "./build/example/particles-dof-app.js":
/*!********************************************!*\
  !*** ./build/example/particles-dof-app.js ***!
  \********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

eval("\nObject.defineProperty(exports, \"__esModule\", ({ value: true }));\nconst TinyShade_1 = __webpack_require__(Object(function webpackMissingModule() { var e = new Error(\"Cannot find module '../TinyShade'\"); e.code = 'MODULE_NOT_FOUND'; throw e; }()));\ndocument.addEventListener(\"DOMContentLoaded\", async () => {\n    const app = await TinyShade_1.TinyShade.create(\"canvas\");\n    const COUNT = 1_000_000;\n    const STORAGE_SIZE = COUNT * 4;\n    (await app.setUniforms(l => {\n        l.addUniform({ name: \"count\", value: COUNT });\n    })\n        /**\n         * COMPUTE PASS: Preserved precisely.\n         * We hijack the Alpha channel to store Z-depth for the DOF effect.\n         */\n        .addCompute(STORAGE_SIZE, `\r\n        ##WORKGROUP_SIZE\r\n        fn main(@builtin(global_invocation_id) id: vec3u) {\r\n            let i = id.x;\r\n            if (i >= u32(u.count)) { return; }\r\n            \r\n            let b = i * 4u;\r\n            var p = vec4f(data[b], data[b+1], data[b+2], data[b+3]);\r\n\r\n          \r\n            p.z -= 0.0005 + (fract(f32(i) * 0.13) * 0.001);\r\n\r\n            if (p.z < 0.1 || u.time < 0.1) {\r\n                let angle = fract(f32(i) * 0.001) * 6.28 + u.time * 0.2;\r\n                let radius = 0.5 + fract(f32(i) * 0.5) * 2.0;\r\n                p.x = cos(angle) * radius;\r\n                p.y = sin(angle) * radius;\r\n                p.z = 4.0 + fract(f32(i) * 123.45); \r\n                p.w = 0.1 + fract(f32(i) * 7.7) * 0.5;\r\n            }\r\n\r\n            p.x += sin(p.z + u.time) * 0.002;\r\n            p.y += cos(p.z + u.time) * 0.002;\r\n\r\n            data[b] = p.x; data[b+1] = p.y; data[b+2] = p.z; data[b+3] = p.w;\r\n\r\n            let res = vec2f(u.resolution.xy);\r\n            let aspect = res.x / res.y;\r\n            let fov = 1.0; \r\n            let screenX = (p.x / p.z) * fov;\r\n            let screenY = (p.y / (p.z * aspect)) * fov;\r\n\r\n            let coords = vec2i(\r\n                i32((screenX * 0.5 + 0.5) * res.x), \r\n                i32((screenY * 0.5 + 0.5) * res.y)\r\n            );\r\n            \r\n            if(coords.x <= 1 || coords.x >= i32(res.x)-1 || coords.y <= 1 || coords.y >= i32(res.y)-1) { return; }\r\n\r\n            let depthFactor = saturate(1.0 - (p.z / 4.0));\r\n            let color = mix(vec3f(0.0, 0.1, 0.5), vec3f(0.2, 0.9, 1.0), depthFactor);\r\n            \r\n            // NOTE: Store color in RGB and Z-DEPTH in Alpha\r\n            textureStore(outTex, coords, vec4f(color * (depthFactor * 3.0), p.z));\r\n            \r\n            if (depthFactor > 0.7) {\r\n                 let dim = vec4f(color * 0.5, p.z); // Keep Z even in glow\r\n                 textureStore(outTex, coords + vec2i(1, 0), dim);\r\n                 textureStore(outTex, coords - vec2i(1, 0), dim);\r\n            }\r\n        }\r\n    `)\n        /**\n         * PASS 0: Temporal Accumulation & DOF\n         * This uses prevPass0 to blend frames over time.\n         */\n        .addPass(`\r\n        @fragment fn main(in: VSOut) -> @location(0) vec4f {\r\n            let uv = in.uv;\r\n            \r\n            // 1. Get raw particle data and history\r\n            let current = textureSampleLevel(computeTex, samp, uv, 0.0);\r\n            let history = textureSampleLevel(prevPass0, samp, uv, 0.0).rgb;\r\n\r\n            // 2. Depth of Field (Focus is at 1.5 distance)\r\n            let coc = abs(current.a - 1.5) * 0.012;\r\n            let jitter = vec2f(cos(u.time * 20.0), sin(u.time * 20.0)) * coc;\r\n            let blurred = textureSampleLevel(computeTex, samp, uv + jitter, 0.0).rgb;\r\n            \r\n            // Selectively blur based on Circle of Confusion\r\n            let bloom = select(current.rgb, (current.rgb + blurred) * 1.5, coc > 0.002);\r\n\r\n            // 3. Galactic Background (Preserved)\r\n            let d = length(uv * 2.0 - 1.0);\r\n            let bgGlow = (0.005 / pow(d, 1.5)) * vec3f(0.1, 0.2, 0.5);\r\n\r\n            // 4. Temporal Accumulation (Trails/Persistence)\r\n            // 0.92 = high persistence for creamy star-trails\r\n            let fin = mix(bloom + bgGlow, history, 0.92);\r\n\r\n            return vec4f(fin, 1.0);\r\n        }\r\n    `)\n        /**\n         * MAIN: Post-Process Compositing\n         * We swap textureSample(computeTex...) for textureSample(pass0...)\n         * to see the accumulated results.\n         */\n        .main(`\r\n        @fragment fn main(in: VSOut) -> @location(0) vec4f {\r\n            let uv = in.uv;\r\n            let centerDist = length(uv - 0.5);\r\n            \r\n            // Chromatic aberration using our new smooth Pass0 result\r\n            let shift = centerDist * 0.015;\r\n            let r = textureSample(pass0, samp, uv + vec2f(shift, 0.0)).r;\r\n            let g = textureSample(pass0, samp, uv).g;\r\n            let b = textureSample(pass0, samp, uv - vec2f(shift, 0.0)).b;\r\n            \r\n            let combined = vec3f(r, g, b);\r\n\r\n            // Filmic Curve\r\n            let x = max(vec3f(0.0), combined - 0.004);\r\n            let mapped = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);\r\n\r\n            return vec4f(mapped * smoothstep(1.0, 0.2, centerDist), 1.0);\r\n        }\r\n    `))\n        .run();\n});\n\n\n//# sourceURL=webpack://tinyshade/./build/example/particles-dof-app.js?");

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
/******/ 	var __webpack_exports__ = __webpack_require__("./build/example/particles-dof-app.js");
/******/ 	
/******/ })()
;