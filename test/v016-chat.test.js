// 0.16 bước 4: trò chuyện kiểu LM Studio — tham số, preset (AIVN + LM Studio), chính sách tràn ngữ cảnh, seed/chuỗi dừng/JSON/suy nghĩ với mô hình thật
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs');
const CF = require('../src/chatfit'); const PR = require('../src/presets');

test('cleanChatParams: giữ giá trị hợp lệ, bỏ giá trị sai, mặc định cắt phần giữa', () => {
  assert.deepStrictEqual(CF.cleanChatParams(null), { overflow: 'trim-middle' });
  const r = CF.cleanChatParams({ topK: 20, topP: 1.5, minP: '0.05', seed: 42.7, stop: ['###', '', 'x'.repeat(200)], overflow: 'rolling', jsonSchema: { type: 'object' }, repeatPenalty: null });
  assert.deepStrictEqual(r, { overflow: 'rolling', topK: 20, minP: 0.05, seed: 42, stop: ['###'], jsonSchema: { type: 'object' } });
  assert.strictEqual(CF.cleanChatParams({ overflow: 'xoa-het' }).overflow, 'trim-middle');
});
const conv = (n) => [{ role: 'system', content: 'S' }, ...Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `tin ${i} ` + 'x'.repeat(300) }))];
const ct = (t) => Math.ceil(String(t).length / 3);
test('tràn ngữ cảnh: vừa thì giữ nguyên', () => { const m = conv(5); const r = CF.fitOverflow(m, 'trim-middle', 256, 8192, ct); assert.strictEqual(r.dropped, 0); assert.strictEqual(r.messages, m); });
test('tràn ngữ cảnh: cắt phần giữa giữ lời nhắc hệ thống, lượt đầu và tin cuối', () => {
  const m = conv(41); const r = CF.fitOverflow(m, 'trim-middle', 256, 2048, ct);
  assert.ok(r.dropped > 0); const out = r.messages;
  assert.strictEqual(out[0].role, 'system'); assert.match(out[1].content, /^tin 0 /); assert.match(out[2].content, /^tin 1 /);
  assert.strictEqual(out[out.length - 1], m[m.length - 1]);
  assert.ok(out.reduce((s, x) => s + ct(x.content) + 8, 0) <= 2048 - 256 - 64);
});
test('tràn ngữ cảnh: trượt bỏ tin cũ nhất, phần hội thoại không mở đầu bằng trợ lý', () => {
  const m = conv(41); const r = CF.fitOverflow(m, 'rolling', 256, 2048, ct); const out = r.messages;
  assert.strictEqual(out[0].role, 'system'); assert.strictEqual(out[1].role, 'user'); assert.doesNotMatch(out[1].content, /^tin 0 /);
  assert.strictEqual(out[out.length - 1], m[m.length - 1]);
});
test('tràn ngữ cảnh: “dừng lại” báo lỗi tiếng Việt có gợi ý Tăng ngữ cảnh', () => {
  assert.throws(() => CF.fitOverflow(conv(41), 'stop', 256, 2048, ct), (e) => e.code === 'CTX_FULL' && /cần nhiều ngữ cảnh hơn/.test(e.message) && /Tăng ngữ cảnh/.test(e.message));
});
test('preset AIVN: các preset có sẵn hợp lệ, tên không trùng, JSON xuất/nhập khứ hồi', () => {
  const names = new Set(); for (const p of PR.BUILTIN) { const c = PR.cleanPreset(p); assert.ok(c.systemPrompt.length > 20); assert.ok(!names.has(c.name)); names.add(c.name); if (p.params.jsonSchema) JSON.parse(p.params.jsonSchema); }
  const p = { name: 'Thử', systemPrompt: 'Chào', temperature: 0.4, maxTokens: 512, params: { topK: 30, stop: ['###'], overflow: 'stop', bogus: 1 } };
  const back = PR.parseImport(PR.toExport(p)); assert.deepStrictEqual(back, { name: 'Thử', systemPrompt: 'Chào', temperature: 0.4, maxTokens: 512, params: { topK: 30, stop: ['###'], overflow: 'stop' } });
});
test('preset LM Studio: đọc được tệp xuất từ LM Studio', () => {
  const j = { name: 'Coder', operation: { fields: [
    { key: 'llm.prediction.systemPrompt', value: 'You are a coder' }, { key: 'llm.prediction.temperature', value: 0.2 },
    { key: 'llm.prediction.topKSampling', value: 40 }, { key: 'llm.prediction.topPSampling', value: { checked: true, value: 0.9 } },
    { key: 'llm.prediction.minPSampling', value: { checked: false, value: 0.05 } }, { key: 'llm.prediction.repeatPenalty', value: { checked: true, value: 1.1 } },
    { key: 'llm.prediction.contextOverflowPolicy', value: 'stopAtLimit' }, { key: 'llm.prediction.stopStrings', value: ['</end>'] },
    { key: 'llm.prediction.structured', value: { type: 'json', jsonSchema: { type: 'object' } } }] } };
  const p = PR.parseImport(JSON.stringify(j));
  assert.strictEqual(p.name, 'Coder'); assert.strictEqual(p.temperature, 0.2);
  assert.deepStrictEqual(p.params, { topK: 40, topP: 0.9, repeatPenalty: 1.1, stop: ['</end>'], overflow: 'stop', jsonOn: true, jsonSchema: JSON.stringify({ type: 'object' }, null, 2) });
  assert.throws(() => PR.parseImport('{"a":1}'), /Không nhận ra/); assert.throws(() => PR.parseImport('khong phai json'), /JSON/);
});
test('kiểm tra lược đồ JSON: bắt kiểu sai, thiếu type, lồng sai', () => {
  assert.strictEqual(CF.schemaError({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'integer' } } }, required: ['a'] }), null);
  assert.match(CF.schemaError({ type: 'khong-co' }), /không hợp lệ/); assert.match(CF.schemaError({ type: 'object', properties: { a: { tipe: 'x' } } }), /gốc\.a: thiếu "type"/);
  assert.match(CF.schemaError([]), /đối tượng/); assert.strictEqual(CF.schemaError({ enum: ['a', 'b'] }), null);
});
const GGUF = process.env.AIVN_TEST_GGUF || '/tmp/udcu/models/bartowski/Qwen_Qwen3-0.6B-GGUF/Qwen_Qwen3-0.6B-Q4_K_M.gguf';
test('mô hình thật: seed lặp lại được, chuỗi dừng, JSON theo lược đồ, khối suy nghĩ tách riêng, có thời gian ra token đầu', { skip: !fs.existsSync(GGUF) && 'không có tệp GGUF thử', timeout: 600000 }, async () => {
  const engine = require('../src/engine');
  try {
    // 1 luồng: llama.cpp CPU nhiều luồng không tất định tuyệt đối (đã kiểm: cùng seed, 1 luồng → giống hệt; nhiều luồng → lệch sau vài token)
    await engine.loadModel('q06', GGUF, { contextSize: 4096, minContextSize: 4096, perf: { threads: 1 } });
    const msgs = [{ role: 'system', content: 'Trả lời ngắn.' }, { role: 'user', content: 'Kể tên 5 loại trái cây Việt Nam. /no_think' }];
    const run = (o) => engine.generate(msgs, { temperature: 1.0, maxTokens: 60, ...o });
    const a = await run({ seed: 7 }), b = await run({ seed: 7 });
    assert.strictEqual(a.text, b.text, 'cùng seed phải ra cùng câu trả lời');
    assert.ok(a.usage.ttft > 0 && a.usage.ttft < a.usage.seconds); assert.ok(a.usage.contextTokens > 10); assert.strictEqual(a.usage.contextSize, 4096);
    const st = await engine.generate([{ role: 'user', content: 'Đếm từ 1 đến 10, mỗi số một dòng. /no_think' }], { temperature: 0, maxTokens: 80, stop: ['5'] });
    assert.ok(!/[6-9]/.test(st.text), 'phải dừng trước số 6: ' + st.text); assert.strictEqual(st.stopReason, 'customStopTrigger');
    const js = await engine.generate([{ role: 'user', content: 'Thủ đô Việt Nam là gì? /no_think' }], { temperature: 0, maxTokens: 120, jsonSchema: { type: 'object', properties: { tra_loi: { type: 'string' } }, required: ['tra_loi'] } });
    const o = JSON.parse(js.text); assert.strictEqual(typeof o.tra_loi, 'string');
    const think = []; const th = await engine.generate([{ role: 'user', content: '2 + 3 = ?' }], { temperature: 0.6, maxTokens: 400, onToken: (t, k) => { if (k === 'think') think.push(t); } });
    assert.ok(th.thought && think.join('') === th.thought, 'Qwen3 suy nghĩ phải đi riêng'); assert.ok(!/<think>/.test(th.text));
  } finally { await engine.unloadModel().catch(() => {}); }
});
