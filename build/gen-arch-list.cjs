// Trích danh sách kiến trúc mô hình mà bản llama.cpp đi kèm node-llama-cpp hỗ trợ → src/llama-archs.json
// Chạy lại sau mỗi lần nâng cấp node-llama-cpp:  node build/gen-arch-list.cjs
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const dir = path.join(__dirname, '..', 'node_modules', '@node-llama-cpp', 'linux-x64', 'bins', 'linux-x64');
const lib = fs.readdirSync(dir).find(f => /^libllama\.v.*\.so$/.test(f) || f === 'libllama.so');
const lines = execFileSync('strings', [path.join(dir, lib)], { maxBuffer: 1 << 28 }).toString().split('\n');
const a = lines.indexOf('clip'), b = lines.indexOf('(unknown)', a);
if (a < 0 || b < 0 || b - a > 400) throw new Error('Không tìm thấy bảng kiến trúc trong ' + lib);
const archs = lines.slice(a, b).filter(s => /^[a-z0-9][a-z0-9_.-]*$/.test(s));
const info = require(path.join(__dirname, '..', 'node_modules', 'node-llama-cpp', 'llama', 'llama.cpp.info.json'));
const out = { llamaCpp: info.tag, nodeLlamaCpp: require(path.join(__dirname, '..', 'node_modules', 'node-llama-cpp', 'package.json')).version, archs };
fs.writeFileSync(path.join(__dirname, '..', 'src', 'llama-archs.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`${archs.length} kiến trúc, llama.cpp ${info.tag}`);
