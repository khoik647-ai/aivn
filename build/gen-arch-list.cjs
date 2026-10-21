// Trích danh sách kiến trúc mô hình mà bản llama.cpp đi kèm node-llama-cpp hỗ trợ → src/llama-archs.json
// Chạy lại sau mỗi lần nâng cấp node-llama-cpp:  node build/gen-arch-list.cjs
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const dir = path.join(__dirname, '..', 'node_modules', '@node-llama-cpp', 'linux-x64', 'bins', 'linux-x64');
const lib = fs.readdirSync(dir).find(f => /^libllama\.v.*\.so$/.test(f) || f === 'libllama.so');
const lines = execFileSync('strings', [path.join(dir, lib)], { maxBuffer: 1 << 28 }).toString().split('\n');
const a = lines.indexOf('clip'), b = lines.indexOf('(unknown)', a);
if (a < 0 || b < 0 || b - a > 400) throw new Error('Không tìm thấy bảng kiến trúc trong ' + lib);
const archs = lines.slice(a, b).filter(s => /^[a-z0-9][a-z0-9_.-]*$/.test(s));
// trình liên kết gộp chuỗi trùng đuôi ("glm4" nằm trong "chatglm4", "qwen2" trong "rwkv6qwen2") nên vài tên không còn trong bảng:
// lấy thêm tên từ lớp llama_model_<tên> (bỏ "_") khi chuỗi đó vẫn có mặt ở cuối một chuỗi khác trong thư viện
const short = lines.filter(l => l.length < 64);
for (const l of lines) { const m = /^_ZN\d+llama_model_(\w+?)D0Ev$/.exec(l); if (!m) continue; const n = m[1].replace(/_/g, '');
  if (!archs.includes(n) && short.some(x => x.endsWith(n))) archs.push(n); }
const info = require(path.join(__dirname, '..', 'node_modules', 'node-llama-cpp', 'llama', 'llama.cpp.info.json'));
const out = { llamaCpp: info.tag, nodeLlamaCpp: require(path.join(__dirname, '..', 'node_modules', 'node-llama-cpp', 'package.json')).version, archs };
fs.writeFileSync(path.join(__dirname, '..', 'src', 'llama-archs.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`${archs.length} kiến trúc, llama.cpp ${info.tag}`);
