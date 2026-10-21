// Tiến trình riêng chạy llama.cpp (node-llama-cpp) và OCR bằng Node.js thuần (không phải Electron).
// Lý do: bộ cấp phát bộ nhớ của Electron chặn mọi lần cấp phát > ~2 GB, làm sập tiến trình khi nạp mô hình lớn chạy bằng CPU.
const engine = require('./engine');
let ocr = null; let grounder = null;
const gens = new Map();
const reply = (m) => { try { process.send(m); } catch {} };
engine.setLoadProgress((p) => reply({ type: 'progress', ...p }));

process.on('message', async (msg) => {
  if (!msg) return;
  if (msg.type === 'abort') { gens.get(msg.reqId)?.abort(); return; }
  const { id, method, args = [] } = msg;
  try {
    let result;
    switch (method) {
      case 'ping': result = { pid: process.pid, node: process.versions.node }; break;
      case 'hardwareInfo': result = await engine.hardwareInfo(); break;
      case 'loadModel': result = await engine.loadModel(args[0], args[1], args[2]); break;
      case 'unloadModel': await engine.unloadModel(); result = engine.status(); break;
      case 'status': result = engine.status(); break;
      case 'countTokens': result = await engine.countTokensAsync(args[0]); break;
      case 'embedLoad': result = await engine.loadEmbedder(args[0], args[1], args[2]); break;
      case 'embedUnload': await engine.unloadEmbedder(); result = engine.embedStatus(); break;
      case 'embedStatus': result = engine.embedStatus(); break;
      case 'embedCount': result = engine.embedCount(args[0]); break;
      case 'embed': result = (await engine.embed(args[0], args[1])).map(v => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')); break;
      case 'generate': {
        const [messages, opts, reqId] = args;
        const ac = new AbortController(); gens.set(reqId, ac);
        try { result = await engine.generate(messages, { ...opts, signal: ac.signal, onToken: (t, k) => reply({ type: 'token', reqId, t, ...(k ? { k } : {}) }) }); }
        finally { gens.delete(reqId); }
        break;
      }
      case 'chatStep': {
        const [messages, opts, reqId] = args;
        const ac = new AbortController(); gens.set(reqId, ac);
        try { result = await engine.chatStep(messages, { ...opts, signal: ac.signal, onToken: (t) => reply({ type: 'token', reqId, t }) }); }
        finally { gens.delete(reqId); }
        break;
      }
      // Chế độ hai mô hình: mô hình định vị (Holo, UI-TARS, Qwen-VL) chạy riêng trong llama-server thứ hai, mô hình lập kế hoạch vẫn là mô hình chữ
      case 'groundLoad': { grounder ||= require('./vision-server').createVisionServer({ log: (m) => console.log('[grounder] ' + m) }); const [gid, gpath, gmm, gopts = {}] = args;
        try { result = await grounder.start({ id: gid, modelPath: gpath, mmprojPath: gmm, contextSize: gopts.contextSize || 4096, gpu: gopts.gpu !== false, threads: gopts.threads, batchSize: gopts.batchSize, extraArgs: gopts.serverArgs, serverExe: gopts.serverExe || null }); }
        catch (e) { if (gopts.gpu === false) throw e; console.log('[grounder] GPU lỗi, thử CPU: ' + e.message); result = await grounder.start({ id: gid, modelPath: gpath, mmprojPath: gmm, contextSize: gopts.contextSize || 4096, gpu: false, threads: gopts.threads, batchSize: gopts.batchSize, extraArgs: gopts.serverArgs }); }
        result = { id: result.id, path: result.path, contextSize: result.contextSize }; break; }
      case 'groundUnload': if (grounder) await grounder.stop(); result = { loaded: false }; break;
      case 'groundStatus': { const st = grounder && grounder.status(); result = st ? { loaded: true, id: st.id, path: st.path } : { loaded: false }; break; }
      case 'groundGenerate': {
        if (!grounder || !grounder.status()) throw new Error('Chưa nạp mô hình định vị.');
        const [messages, opts, reqId] = args; const ac = new AbortController(); gens.set(reqId, ac);
        try { result = await grounder.generate(messages, { ...opts, signal: ac.signal }); } finally { gens.delete(reqId); }
        break;
      }
      case 'ocr': ocr ||= require('./ocr'); result = await ocr.recognize(Buffer.from(args[0], 'base64')); break;
      case 'ocrLines': ocr ||= require('./ocr'); result = await ocr.recognizeLines(Buffer.from(args[0], 'base64')); break;
      default: throw new Error('Không rõ lệnh ' + method);
    }
    reply({ id, result });
  } catch (e) { reply({ id, error: String(e && e.message || e), code: e && e.code, stack: String(e && e.stack || ''), attempts: e && e.attempts, gpu: e && e.gpu }); }
});
// B13 (QA lượt 2): tiến trình chính mất (đóng app, bị kill, sập) → giết NGAY mọi llama-server (đồng bộ) rồi thoát; không chờ dỡ mô hình
// (dỡ mô hình có thể treo khi đang nạp dở, làm llama-server bị bỏ lại giữ vài GB RAM/VRAM).
const VS = require('./vision-server');
let quitting = false;
function quit(why) {
  if (quitting) return; quitting = true;
  VS.killAllSync();
  setTimeout(() => process.exit(0), 2500).unref(); // dỡ mô hình node-llama-cpp tối đa 2,5 giây
  Promise.resolve().then(() => engine.unloadModel()).catch(() => {}).finally(() => process.exit(0));
}
process.on('disconnect', () => quit('mất kết nối tới tiến trình chính'));
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => quit(sig));
process.on('exit', () => VS.killAllSync());
require('./orphans').watchParent(Number(process.env.AIVN_PARENT_PID) || process.ppid, () => quit('tiến trình chính đã dừng'));
reply({ type: 'ready', pid: process.pid, node: process.versions.node });
