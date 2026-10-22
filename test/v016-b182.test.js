'use strict';
// B182: câu cuối / cảnh báo do AIVN AGENT tự ghép (chưa làm được, tự dừng vì lặp, dừng vì bước lỗi) phải theo ngôn ngữ giao diện en/zh,
// không còn tiếng Việt — trừ lý do do chính mô hình viết (giữ nguyên văn).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const A = require('../src/agent/agent');
const RT = require('../src/agent/retry');
const S = require('../src/agent/say');
const { createMemoryStore } = require('../src/agent/memory');
const CT = require('../src/agent/computer-tools');
const { VI } = require('../src/i18n/core');
const NAMES = ['open_app', 'screen_act', 'screen_look'];
const MODEL_REASON = 'cần mô hình nhìn ảnh để thao tác trong Zalo'; // lý do do mô hình viết: được phép còn tiếng Việt

function mkAgent(replies, lang, exec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b182-'));
  const engine = { status: () => ({ loaded: true, contextSize: 8192, id: 'qwen3vl-8b-instruct-q4_k_m', vision: true }), chatStep: async (msgs, o) => { const r = replies.shift(); return typeof r === 'function' ? r(o) : (r || { text: '', toolCalls: [], finishReason: 'stop', usage: {} }); } };
  const defs = Object.fromEntries(NAMES.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => NAMES, defs, has: (n) => n in defs, CompError: CT.CompError, exec: exec || (async (n, a) => ({ forModel: `Đã mở ứng dụng "${a.name}".`, summary: 'Đã mở ' + a.name })) };
  return createAgent({ lang, engine, computer });
}
function createAgent({ lang, engine, computer }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b182m-'));
  return A.createAgent({ engine, computer, getSettings: () => ({ agentFolders: [], agentMemory: false, uiLang: lang }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}), log: () => {} });
}
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 20 } });
const call = (name, args) => ({ text: '', toolCalls: [{ id: 'c' + Math.random(), name, arguments: args }], finishReason: 'tool_calls', usage: { completion_tokens: 10 } });
const cannot = (reason) => ({ text: '', toolCalls: [{ id: 'x', name: 'cannot_do', arguments: { reason } }], finishReason: 'tool_calls', usage: {} });
const Q = { en: 'open Zalo and send a message to Quynh Anh saying good evening', zh: '在 Zalo 里给 Quynh Anh 发消息：晚上好' };
const FAKE = '[screen,look] Zalo\n[screen,act] type "good evening"\nI sent the message.';
const LOOP = 'I will help you with this task right away, step by step, as requested.';
const looping = (o) => new Promise((resolve) => { let i = 0, text = ''; const parts = Array.from({ length: 24 }, () => LOOP).join(' ').match(/.{1,8}/gs);
  const tick = () => { if (o.signal && o.signal.aborted) return resolve({ text, toolCalls: [], finishReason: 'abort', usage: { completion_tokens: Math.ceil(text.length / 4) } });
    if (i >= parts.length) return resolve({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 900 } }); text += parts[i]; o.onToken && o.onToken(parts[i++]); setImmediate(tick); }; tick(); });
// không còn chữ có dấu tiếng Việt, sau khi bỏ lý do của mô hình
const noVi = (t, label) => { const s = String(t == null ? '' : t).split(MODEL_REASON).join(''); assert.ok(!VI.test(s), `${label}: còn tiếng Việt → ${s}`); };

for (const lang of ['en', 'zh']) {
  test(`B182 [${lang}]: cannot_do sau khi chặn bước giả → câu cuối + cảnh báo theo ngôn ngữ giao diện, lý do của mô hình giữ nguyên`, async () => {
    const r = await mkAgent([say(FAKE), say(FAKE), cannot(MODEL_REASON)], lang).run({ messages: [{ role: 'user', content: Q[lang] }], confirm: async () => true });
    assert.ok(r.text.includes(MODEL_REASON), r.text);
    assert.ok(r.text.startsWith(lang === 'en' ? "I couldn't do this yet: " : '我还没能完成这件事：'), r.text);
    noVi(r.text, 'text'); assert.ok(r.warning, 'có cảnh báo chưa thao tác'); noVi(r.warning, 'warning');
  });
  test(`B182 [${lang}]: mô hình lặp chữ hai lần → tự dừng → câu cuối và cảnh báo “lặp” không còn tiếng Việt`, async () => {
    const r = await mkAgent([looping, looping], lang).run({ messages: [{ role: 'user', content: Q[lang] }], confirm: async () => true });
    assert.strictEqual(r.warning, S.say(lang, A.REPEAT_WARN)); assert.notStrictEqual(r.warning, A.REPEAT_WARN);
    noVi(r.text, 'text'); noVi(r.warning, 'warning'); assert.ok(r.text.length < 600, r.text);
  });
  test(`B182 [${lang}]: lặp lại cách đã hỏng → dừng trung thực “chưa làm xong” theo ngôn ngữ giao diện`, async () => {
    const replies = Array.from({ length: 12 }, () => call('screen_act', { action: 'click', element: 'Send' })).concat([say('ok')]);
    const r = await mkAgent(replies, lang, async (n) => n === 'screen_act' ? { forModel: 'Kiểm tra: không thấy phần tử "Send".', summary: 'không thấy phần tử', error: 'không thấy phần tử' } : { forModel: 'ok', summary: 'ok' })
      .run({ messages: [{ role: 'user', content: Q[lang] }], confirm: async () => true });
    assert.strictEqual(r.outcome, 'failed');
    assert.match(r.text, lang === 'en' ? /^I haven't finished this task \(repeating a failed approach\)/ : /^这件事我还没做完（重复已失败的方法）/);
    assert.match(r.text, lang === 'en' ? /Tried:\n- click "Send": 2 times, element not found/ : /已尝试：\n- click "Send"：2 次，/);
    assert.match(r.text, /“Quynh Anh”/); noVi(r.text, 'text'); noVi(r.warning, 'warning');
  });
  test(`B182 [${lang}]: bước công cụ lỗi (open_app) → “chưa làm được” + gợi ý kiểm tra tên ứng dụng theo ngôn ngữ giao diện`, async () => {
    const SRC = 'lối tắt Start Menu (của bạn và mọi người dùng), Desktop, %LOCALAPPDATA%\\Programs, sổ đăng ký (Uninstall, App Paths) và ứng dụng Store (Get-StartApps)';
    const r = await mkAgent([call('open_app', { name: 'Zalo' }), say('Lỗi: không mở được Zalo')], lang, async () => { throw new CT.CompError(`Không tìm thấy ứng dụng "Zalo" sau khi đã kiểm tra ${SRC}. Bước tiếp: thử list_apps với từ khoá ngắn.`); })
      .run({ messages: [{ role: 'user', content: Q[lang] }], confirm: async () => true });
    assert.ok(r.text.includes(lang === 'en' ? 'Check app scan' : '检查应用扫描'), r.text);
    noVi(r.text, 'text'); noVi(r.warning, 'warning');
  });
}

test('B182: honestStatus / finalCheck / guardClaims / cảnh báo theo ngôn ngữ; tiếng Việt giữ nguyên như cũ', () => {
  const tr = RT.createRetryTracker(); const a = { action: 'click', element: 'Gửi' };
  tr.after(a, { error: 'không thấy phần tử' }); tr.after(a, { error: 'không thấy phần tử' });
  for (const lang of ['en', 'zh']) {
    for (const why of ['lặp lại cách đã hỏng', 'nhiều cách đã hỏng bị thử lại', '10 bước liền chưa có tác dụng', 'quan sát màn hình nhiều lần liền mà mô hình không làm bước nào', 'các bước gõ/bấm của AIVN AGENT chưa có tác dụng — không phải lỗi của ứng dụng', 'mô hình định làm tiếp nhưng lượt đã kết thúc', S.say(lang, 'đã chạy quá {0} giây', 240), '']) {
      const t = RT.honestStatus({ tracker: tr, steps: [], reason: why, recipient: 'Quỳnh Anh', app: 'Zalo', lang });
      noVi(t.split('Quỳnh Anh').join('').split('Gửi').join(''), `honest(${why})`);
      noVi(RT.honestStatus({ steps: [{ status: 'ok' }, { status: 'ok' }], reason: why, lang }), `honest-ok(${why})`);
    }
    const fc = RT.finalCheck('Đã gửi xong.', tr, lang); assert.ok(fc); noVi(fc.split('Gửi').join(''), 'finalCheck');
    // lý do kiểm chứng gửi lấy đúng mẫu của send-verify; phần trong “…” là chữ người dùng/tin nhắn (được giữ nguyên)
    for (const why of ['tin “chúc ngủ ngon” vẫn còn trong ô soạn — CHƯA gửi', 'không thấy bong bóng tin “chúc ngủ ngon” trong khung tin nhắn sau khi gửi', 'tiêu đề cuộc trò chuyện đang mở không phải “Quỳnh Anh” (đang là “Lan”) — có thể đang ở sai cuộc trò chuyện']) {
      const steps = [{ name: 'screen_act', status: 'ok', summary: 'Bấm “Gửi”' }, { name: 'screen_act', status: 'ok', verify: { sent: false, why } }];
      const g = A.guardClaims('Mình đã gửi tin nhắn thành công.', steps, lang);
      assert.strictEqual(g.blocked, true); noVi(g.text.replace(/“[^”]*”/g, '“”'), 'guardClaims.text'); noVi(g.warning, 'guardClaims.warning');
    }
    assert.strictEqual(A.guardClaims('Mình đã gửi tin nhắn thành công.', [], 'vi').text.startsWith('Mình CHƯA xác nhận được là tin nhắn đã gửi tới đúng người.'), true);
    for (const w of [A.REPEAT_WARN, A.NO_ACTION_WARN, A.NO_COMP_WARN, A.BUDGET_WARN, A.NO_ACTION_OK_WARN].filter(Boolean)) noVi(S.say(lang, w), w.slice(0, 30));
    for (const k of ['Mình chưa làm được việc này.', 'Đã làm xong và kiểm chứng trên màn hình.', '⚠ {0}. AIVN AGENT đã dừng, không gửi thêm gì. Bạn mở cuộc trò chuyện đó để thu hồi/xoá tin giúp mình.']) noVi(S.say(lang, k, 'x'), k);
  }
  // tiếng Việt: y hệt câu cũ
  assert.strictEqual(RT.honestStatus({ reason: 'lặp lại cách đã hỏng' }), 'Mình chưa làm xong việc này (lặp lại cách đã hỏng), nên dừng lại thay vì thử mãi một cách đã hỏng.\n\nBạn có thể mở sẵn đúng cửa sổ/màn hình cần dùng rồi giao lại việc, hoặc tự làm bước này.');
  assert.strictEqual(S.say('vi', A.REPEAT_WARN), A.REPEAT_WARN);
  assert.strictEqual(S.say('en', 'Đã làm {0} bước nhưng chưa kiểm chứng được là xong.', 1), 'Did 1 step, but could not verify that the task is done.');
  assert.strictEqual(S.say('en', 'Mình chưa làm được việc này: {0}.', 'Lý do của mô hình'), "I couldn't do this yet: Lý do của mô hình.");
});
