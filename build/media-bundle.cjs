// Đóng gói bộ nghe (chép lời âm thanh/video) cho cửa sổ ẩn của AIVN:
//   src/media/vendor/asr-bundle.mjs  ← @huggingface/transformers (bản web) + onnxruntime-web (JS), gộp bằng esbuild
//   src/media/vendor/ort-wasm-simd-threaded.jsep.{mjs,wasm} ← lõi WASM/WebGPU của onnxruntime-web, ĐÚNG phiên bản transformers dùng
// Thư mục vendor/ không đưa lên git (tệp .wasm ~28 MB); release.sh chạy script này trước khi build.
'use strict';
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..'); const OUT = path.join(ROOT, 'src/media/vendor');
const ortVer = require(path.join(ROOT, 'node_modules/onnxruntime-web/package.json')).version;
const want = require(path.join(ROOT, 'node_modules/@huggingface/transformers/package.json')).dependencies['onnxruntime-web'];
if (want !== ortVer) throw new Error(`onnxruntime-web ${ortVer} ≠ bản transformers cần (${want}) — npm i -D -E onnxruntime-web@${want}`);
fs.mkdirSync(OUT, { recursive: true });
require('esbuild').buildSync({
  stdin: { contents: "export { pipeline, env, Tensor } from '@huggingface/transformers';", resolveDir: ROOT, loader: 'js' },
  bundle: true, format: 'esm', platform: 'browser', minify: true, legalComments: 'none', outfile: path.join(OUT, 'asr-bundle.mjs'), logLevel: 'warning',
});
for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) fs.copyFileSync(path.join(ROOT, 'node_modules/onnxruntime-web/dist', f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'VERSION.json'), JSON.stringify({ transformers: require(path.join(ROOT, 'node_modules/@huggingface/transformers/package.json')).version, ort: ortVer }) + '\n');
for (const f of fs.readdirSync(OUT)) console.log(`${f}\t${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(2)} MB`);
