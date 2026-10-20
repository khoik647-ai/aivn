// Chạy mã ngắn cho AIVN AGENT.
// JavaScript: luồng Worker riêng + ngữ cảnh vm mới tinh. Không truyền bất kỳ đối tượng nào của tiến trình chính vào
// ngữ cảnh (nên không có require, process, fetch, tệp hay mạng); tắt sinh mã từ chuỗi và WebAssembly; giới hạn thời gian và bộ nhớ.
// Python (tuỳ chọn): chỉ khi máy có sẵn Python và người dùng bật; chạy trong thư mục tạm với móc kiểm tra (audit hook)
// chặn mạng, tiến trình con và ghi/đọc tệp ngoài thư mục tạm. Đây là biện pháp hạn chế, không phải cách ly tuyệt đối.
const { Worker } = require('worker_threads');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');
const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
// console được tạo BÊN TRONG ngữ cảnh: mã người dùng không chạm được tới đối tượng nào bên ngoài
vm.runInContext(\`
  (function () {
    const out = []; let size = 0;
    const show = (v) => { try { if (typeof v === 'string') return v; if (typeof v === 'undefined') return 'undefined'; if (typeof v === 'function') return '[hàm ' + (v.name || 'ẩn danh') + ']'; if (typeof v === 'bigint') return v + 'n'; return JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x + 'n' : x, 2) ?? String(v); } catch { return String(v); } };
    const log = (...a) => { const line = a.map(show).join(' '); size += line.length; if (size < 20000) out.push(line); };
    globalThis.console = { log, info: log, warn: log, error: log, debug: log, table: log };
    globalThis.__aivnOut = out; globalThis.__aivnShow = show;
  })();
\`, ctx);
if (typeof workerData.input === 'string') ctx.INPUT = workerData.input; // nội dung tệp do AIVN đọc sẵn (chuỗi), mã không tự đọc tệp
let value, error = null;
try { value = vm.runInContext(workerData.code, ctx, { timeout: workerData.timeout, filename: 'ma-cua-ban.js' }); }
catch (e) { error = (e && e.name ? e.name + ': ' : '') + (e && e.message || String(e)); }
const finish = (v, err) => {
  let shown = null, logs = [];
  try { logs = vm.runInContext('Array.from(__aivnOut)', ctx, { timeout: 200 }).map(String); } catch {}
  if (!err && v !== undefined) { try { ctx.__v = v; shown = String(vm.runInContext('__aivnShow(__v)', ctx, { timeout: 200 })); } catch { shown = '[không hiển thị được]'; } }
  parentPort.postMessage({ logs, result: shown, error: err });
};
if (!error && value && typeof value === 'object' && typeof value.then === 'function') {
  try { ctx.__p = value; vm.runInContext('__p.then(v => { globalThis.__done = { v }; }, e => { globalThis.__done = { e: String(e && e.message || e) }; })', ctx, { timeout: workerData.timeout }); } catch {}
  const t0 = Date.now();
  const poll = () => { let d; try { d = vm.runInContext('globalThis.__done', ctx, { timeout: 100 }); } catch {}
    if (d) return finish(d.e ? undefined : d.v, d.e ? 'Lỗi: ' + d.e : null);
    if (Date.now() - t0 > workerData.timeout) return finish(undefined, 'Hết thời gian chờ Promise');
    setTimeout(poll, 10); };
  poll();
} else finish(value, error);
`;

// Dòng cuối dạng {a, b} hay {x: 1} bị JavaScript hiểu là khối lệnh: đổi thành biểu thức đối tượng để trả đúng giá trị
function fixTrailingObject(code) {
  const lines = code.replace(/\s+$/, '').split('\n');
  let i = lines.length - 1, tail = '';
  while (i >= 0) { tail = lines[i] + (tail ? '\n' + tail : ''); if (/^\s*\{/.test(lines[i])) break; i--; }
  if (i < 0) return code;
  const t = tail.trim().replace(/;$/, '');
  if (/^\{[\s\S]*\}$/.test(t) && !/;|\breturn\b|\bconst\b|\blet\b|\bvar\b|\bif\b|\bfor\b/.test(t.slice(1, -1)) && /^\{\s*[\w$'"]+\s*[,:}]/.test(t))
    return [...lines.slice(0, i), `(${t})`].join('\n');
  return code;
}

function runJavaScript(code, { timeoutMs = 3000, signal, input } = {}) {
  return new Promise((resolve) => {
    if (typeof code !== 'string' || !code.trim()) return resolve({ ok: false, error: 'Không có mã để chạy' });
    code = fixTrailingObject(code);
    if (code.length > 20000) return resolve({ ok: false, error: 'Mã quá dài (tối đa 20.000 ký tự)' });
    const t0 = Date.now();
    const w = new Worker(WORKER_SRC, { eval: true, workerData: { code, timeout: timeoutMs, input: typeof input === 'string' ? input : undefined }, env: {}, stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, codeRangeSizeMb: 16, stackSizeMb: 4 } });
    let settled = false;
    const done = (r) => { if (settled) return; settled = true; clearTimeout(kill); signal?.removeEventListener('abort', onAbort); w.terminate().catch(() => {}); resolve({ ...r, ms: Date.now() - t0 }); };
    const kill = setTimeout(() => done({ ok: false, error: `Quá thời gian ${timeoutMs / 1000} giây, đã dừng` }), timeoutMs + 1500);
    const onAbort = () => done({ ok: false, error: 'Đã dừng theo yêu cầu' });
    signal?.addEventListener('abort', onAbort);
    w.on('message', (m) => done(m.error ? { ok: false, error: /timed out/i.test(m.error) ? `Quá thời gian ${timeoutMs / 1000} giây, đã dừng` : m.error, logs: m.logs } : { ok: true, result: m.result, logs: m.logs }));
    w.on('error', (e) => done({ ok: false, error: /heap|memory/i.test(e.message) ? 'Mã dùng quá nhiều bộ nhớ (giới hạn 64 MB)' : e.message }));
    w.on('exit', () => done({ ok: false, error: 'Mã đã dừng bất thường' }));
  });
}

// ---- Python (không bắt buộc) ----
let pyCache;
function findPython() {
  if (pyCache !== undefined) return pyCache;
  const cands = process.platform === 'win32' ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
  pyCache = null;
  for (const [exe, pre] of cands) {
    try {
      const v = execFileSync(exe, [...pre, '-c', 'import sys;print(sys.version.split()[0]);print(sys.executable)'], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/);
      if (/^3\.(8|9|1\d)/.test(v[0])) { pyCache = { exe, pre, version: v[0], path: v[1] }; break; }
    } catch {}
  }
  return pyCache;
}
const PY_GUARD = `
import sys, os
_root = os.path.realpath(os.getcwd())
_allow_read = [os.path.realpath(p) for p in {sys.prefix, sys.base_prefix, sys.exec_prefix, os.path.dirname(os.__file__)} if p]
_blocked = ('socket.', 'subprocess.', 'os.system', 'os.exec', 'os.spawn', 'os.posix_spawn', 'os.fork', 'os.kill', 'ctypes.', 'winreg.', 'urllib.', 'http.', 'ftplib.', 'smtplib.', 'shutil.rmtree', 'os.remove', 'os.unlink', 'os.rmdir', 'os.rename', 'os.chmod', 'os.chown', 'os.symlink', 'os.link', 'os.truncate', 'os.putenv', 'os.unsetenv', 'sys.addaudithook', 'import ctypes', 'webbrowser.')
def _inside(p, roots):
    try:
        rp = os.path.realpath(p if isinstance(p, (str, bytes)) else str(p))
        if isinstance(rp, bytes): rp = rp.decode('utf8', 'replace')
        return any(rp == r or rp.startswith(r + os.sep) for r in roots)
    except Exception:
        return False
def _hook(ev, args):
    if ev.startswith(_blocked) or (ev == 'import' and args and args[0] in ('ctypes', '_ctypes', 'socket', '_socket', 'subprocess', '_posixsubprocess', 'multiprocessing')):
        raise PermissionError('AIVN: không được phép (' + ev + ')')
    if ev == 'open' and args and isinstance(args[0], (str, bytes, os.PathLike)):
        mode = args[1] if len(args) > 1 and isinstance(args[1], str) else 'r'
        writing = any(c in mode for c in 'wax+')
        if writing and not _inside(args[0], [_root]):
            raise PermissionError('AIVN: chỉ được ghi tệp trong thư mục tạm')
        if not writing and not _inside(args[0], [_root] + _allow_read):
            raise PermissionError('AIVN: không được đọc tệp ngoài thư mục tạm')
sys.addaudithook(_hook)
del _hook
`;
function runPython(code, { timeoutMs = 10000, signal } = {}) {
  return new Promise((resolve) => {
    const py = findPython();
    if (!py) return resolve({ ok: false, error: 'Máy chưa có Python 3' });
    if (typeof code !== 'string' || !code.trim()) return resolve({ ok: false, error: 'Không có mã để chạy' });
    if (code.length > 20000) return resolve({ ok: false, error: 'Mã quá dài (tối đa 20.000 ký tự)' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-py-'));
    fs.writeFileSync(path.join(dir, 'ma.py'), code, 'utf8');
    // chạy: -I (cách ly môi trường người dùng), móc kiểm tra cài trước rồi mới chạy mã
    const boot = PY_GUARD + `\nimport runpy\nrunpy.run_path('ma.py', run_name='__main__')\n`;
    const t0 = Date.now();
    const env = { PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '' };
    const p = spawn(py.exe, [...py.pre, '-I', '-c', boot], { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { if (out.length < 20000) out += d; });
    p.stderr.on('data', (d) => { if (err.length < 8000) err += d; });
    const finish = (r) => { clearTimeout(t); signal?.removeEventListener('abort', ab); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} resolve({ ...r, ms: Date.now() - t0, python: py.version }); };
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    const ab = () => { try { p.kill('SIGKILL'); } catch {} };
    signal?.addEventListener('abort', ab);
    p.on('error', (e) => finish({ ok: false, error: e.message }));
    p.on('close', (code, sig) => {
      if (sig) return finish({ ok: false, error: signal?.aborted ? 'Đã dừng theo yêu cầu' : `Quá thời gian ${timeoutMs / 1000} giây, đã dừng`, logs: out ? [out] : [] });
      const lines = err.trim().split(/\r?\n/); const last = (lines.pop() || '').trim();
      const loc = [...lines].reverse().find(l => /File "ma\.py", line \d+/.test(l));
      const tb = (loc ? loc.trim().replace(/^File "ma\.py", line (\d+).*/, 'dòng $1') + ': ' : '') + last;
      finish(code === 0 ? { ok: true, result: null, logs: out ? [out.replace(/\s+$/, '')] : [] } : { ok: false, error: tb || `Mã thoát ${code}`, logs: out ? [out] : [] });
    });
  });
}

module.exports = { runJavaScript, runPython, findPython, fixTrailingObject };
