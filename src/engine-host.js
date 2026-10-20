// Tiến trình riêng chạy llama.cpp (node-llama-cpp) và OCR bằng Node.js thuần (không phải Electron).
// Lý do: bộ cấp phát bộ nhớ của Electron chặn mọi lần cấp phát > ~2 GB, làm sập tiến trình khi nạp mô hình lớn chạy bằng CPU.
const engine = require('./engine');
let ocr = null;
const gens = new Map();
const reply = (m) => { try { process.send(m); } catch {} };

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
        try { result = await engine.generate(messages, { ...opts, signal: ac.signal, onToken: (t) => reply({ type: 'token', reqId, t }) }); }
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
      case 'ocr': ocr ||= require('./ocr'); result = await ocr.recognize(Buffer.from(args[0], 'base64')); break;
      default: throw new Error('Không rõ lệnh ' + method);
    }
    reply({ id, result });
  } catch (e) { reply({ id, error: String(e && e.message || e), code: e && e.code, stack: String(e && e.stack || ''), attempts: e && e.attempts, gpu: e && e.gpu }); }
});
process.on('disconnect', async () => { try { await engine.unloadModel(); } catch {} process.exit(0); });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { try { await engine.unloadModel(); } catch {} process.exit(0); });
reply({ type: 'ready', pid: process.pid, node: process.versions.node });
