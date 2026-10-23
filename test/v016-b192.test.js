'use strict';
// B192 (#59): bước gõ/gửi chỉ xong khi ảnh (OCR/mắt nhìn) hoặc cây UIA/AX có đúng chữ.
// Không thấy chữ → nhìn lại có hạn rồi trả thất bại, không báo xong. Việc cũng không xong nếu còn bước gõ thiếu bằng chứng.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const A = require('../src/agent/agent');
const TS = require('../src/agent/typed-seen');
const QA = require('../src/qa-runner');
const CT = require('../src/agent/computer-tools');
const { createMemoryStore } = require('../src/agent/memory');
const { VI } = require('../src/i18n/core');

const NAMES = ['open_app', 'screen_act', 'screen_look'];
const say = (text) => ({ text, toolCalls: [], finishReason: 'stop', usage: { completion_tokens: 8 } });
const call = (name, args) => ({ text: '', toolCalls: [{ id: 'c' + Math.random().toString(16).slice(2), name, arguments: args }], finishReason: 'tool_calls', usage: { completion_tokens: 4 } });

function mkAgent(replies, lang, exec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b192-'));
  const engine = { status: () => ({ loaded: true, contextSize: 8192, id: 'qwen3vl-8b-instruct-q4_k_m', vision: true }), chatStep: async () => replies.shift() || say('') };
  const defs = Object.fromEntries(NAMES.map(n => [n, CT.DEFS[n]]));
  const computer = { names: () => NAMES, defs, has: (n) => n in defs, CompError: CT.CompError, exec };
  return A.createAgent({ engine, computer, gateOk: () => true, getSettings: () => ({ agentFolders: [], agentMemory: false, agentComputer: true, agentScreen: true, uiLang: lang }), memory: createMemoryStore(path.join(root, 'm.json')), scheduler: {}, trash: async () => {}, extractFile: async () => ({}), embedForMemory: async () => ({}) });
}
const run = (agent, q) => agent.run({ messages: [{ role: 'user', content: q }], confirm: async () => true });

const typeStep = (r) => r.steps.find(s => s.args && s.args.action === 'type_text');
const MISS = 'CHƯA thấy chữ vừa gõ trong danh sách phần tử (có thể ô không hiện giá trị) — hãy kiểm tra trước khi làm tiếp.';
const HIT = 'Đã thấy chữ vừa gõ trên màn hình.';
// Kết quả như desktop-agent: có typedSeen, và khi không thấy chữ thì error + câu kiểm tra cũ (bộ thử lại vẫn nhận ra).
function actResult(a, proof) {
  if (a.action !== 'type_text') return { forModel: `Đã bấm "${a.element || ''}".\nKiểm tra: Màn hình đã thay đổi sau thao tác.`, summary: 'bấm' };
  const ok = !!(proof && proof.ok);
  const line = ok ? HIT : MISS;
  return { forModel: `Đã gõ "${a.text}".\nKiểm tra: ${line}`, summary: ok ? 'gõ' : 'gõ · chưa thấy chữ vừa gõ', detail: line, typedSeen: proof, ...(ok ? {} : { error: 'chưa thấy chữ vừa gõ' }) };
}

const LONG = 'Xin chào, đây là một đoạn văn dài để kiểm tra chữ chỉ hiện một phần trên màn hình của Notepad khi ô soạn không đủ chỗ.';
const VI_TEXT = 'Họp lúc 8 giờ, nhớ mang tài liệu.';

test('B192: chuẩn hoá — khoảng trắng, xuống dòng, NFC, dấu tiếng Việt, đầu/đuôi chữ dài', () => {
  assert.strictEqual(TS.textOnScreen('hello world', { uia: '' }).ok, false);
  assert.strictEqual(TS.textOnScreen('hello world', { uia: 'hello   world' }).ok, true);
  assert.strictEqual(TS.textOnScreen('hello\nworld', { uia: 'hello world' }).via, 'uia');
  assert.strictEqual(TS.textOnScreen('hello\r\nworld', { ocr: 'hello\u2028world' }).via, 'ocr');
  const nfd = VI_TEXT.normalize('NFD');
  assert.notStrictEqual(nfd, VI_TEXT.normalize('NFC'));
  const vi = TS.textOnScreen(VI_TEXT, { uia: nfd });
  assert.strictEqual(vi.ok, true); assert.strictEqual(vi.via, 'uia');
  const bare = TS.textOnScreen(VI_TEXT, { ocr: 'Hop luc 8 gio, nho mang tai lieu.' });
  assert.strictEqual(bare.ok, true); assert.strictEqual(bare.via, 'ocr');
  assert.strictEqual(TS.textOnScreen('Lịch họp nhóm', { ocr: 'Lich hop nhém' }).ok, true, 'OCR sai một chữ vẫn nhận như B76');
  assert.strictEqual(TS.textOnScreen('hello world', { vision: 'màn hình đang hiện hello world trong Notepad' }).via, 'vision');
  const head = LONG.slice(0, TS.HEAD);
  const tail = LONG.slice(-TS.TAIL);
  assert.ok(LONG.length > TS.LONG);
  assert.strictEqual(TS.textOnScreen(LONG, { uia: head + ' …' }).part, 'head');
  assert.strictEqual(TS.textOnScreen(LONG, { ocr: '… ' + tail }).part, 'tail');
  assert.strictEqual(TS.textOnScreen(LONG, { uia: LONG.slice(40, 70) }).ok, false, 'chỉ khúc giữa thì chưa đủ');
  assert.strictEqual(TS.textOnScreen('ok', { uia: 'token' }).ok, false, 'chữ ngắn không khớp nằm trong từ khác');
  assert.strictEqual(TS.textOnScreen('ok', { uia: 'ok' }).ok, true);
});

test('B192: ảnh bị che vì bí mật không phải bằng chứng; cây UIA/AX vẫn là', () => {
  const secretOcr = { ocr: 'hello world', vision: 'hello world', shotBlanked: true };
  assert.strictEqual(TS.textOnScreen('hello world', secretOcr).ok, false);
  assert.strictEqual(TS.textOnScreen('hello world', secretOcr).why, 'shot-blanked');
  const uia = TS.textOnScreen('hello world', { ...secretOcr, uia: 'hello world' });
  assert.strictEqual(uia.ok, true); assert.strictEqual(uia.via, 'uia');
  const obs = TS.collect({ elements: [{ name: 'Text editor', value: 'hello world', ocr: false }, { name: 'hello world', ocr: true }] }, { seen: 'hello world', shotBlanked: true });
  assert.deepStrictEqual(obs.ocr, ['hello world']);
  assert.strictEqual(obs.vision, '');
  assert.strictEqual(TS.textOnScreen('hello world', obs).via, 'uia');
});

test('B192: chữ đã có sẵn từ trước khi gõ thì không tính là vừa gõ; chữ mới thì có', () => {
  const doc = { uia: ['File', 'Edit', 'hello world'] };
  assert.strictEqual(TS.textOnScreen('hello world', doc, doc).why, 'already-there');
  assert.strictEqual(TS.textOnScreen('hello world', doc, { uia: ['File', 'Edit'] }).ok, true);
  assert.strictEqual(TS.textOnScreen('hello world', { uia: 'hello world hello world' }, { uia: 'hello world' }).ok, true, 'thêm một lần nữa thì số lần xuất hiện tăng');
});

test('B192: nhìn lại có hạn — hết lần thì thất bại; thấy ở lần sau thì xong', async () => {
  let n = 0;
  const miss = await TS.confirmTyped('hello world', async () => { n++; return { uia: '' }; }, { looks: 3 });
  assert.strictEqual(miss.ok, false); assert.strictEqual(n, 3); assert.strictEqual(miss.looks, 3);
  let k = 0;
  const hit = await TS.confirmTyped('hello world', async () => ({ uia: ++k === 2 ? 'hello world' : '' }), { looks: 3 });
  assert.strictEqual(hit.ok, true); assert.strictEqual(hit.looks, 2); assert.strictEqual(k, 2);
  let stopped = 0;
  const ac = new AbortController(); ac.abort();
  const cut = await TS.confirmTyped('hello world', async () => { stopped++; return { uia: 'hello world' }; }, { looks: 3, signal: ac.signal });
  assert.strictEqual(cut.ok, false); assert.strictEqual(stopped, 0);
});

test('B192: việc không xong khi còn bước gõ thiếu bằng chứng; lần sau cùng chữ thì được', () => {
  const w = (text, ok, extra = {}) => ({ name: 'screen_act', args: { action: 'type_text', text }, status: ok ? 'ok' : 'error', typedSeen: { ok }, ...extra });
  assert.strictEqual(TS.taskWritesOk([w('hello', false), { name: 'screen_act', args: { action: 'click' }, status: 'ok' }]).ok, false);
  assert.strictEqual(TS.taskWritesOk([w('hello', true)]).ok, true);
  assert.strictEqual(TS.taskWritesOk([{ name: 'screen_act', args: { action: 'click' }, status: 'ok' }]).ok, true);
  assert.strictEqual(TS.taskWritesOk([w('hello', false), w('hello', true)]).ok, true, 'thử lại cùng chữ và thấy');
  assert.strictEqual(TS.taskWritesOk([w('hello', false), w('world', true)]).ok, false, 'chữ khác không cứu chữ chưa hiện');
  assert.strictEqual(TS.evidenceOf({ detail: MISS, args: { action: 'type_text', text: 'x' } }), false);
  assert.strictEqual(TS.evidenceOf({ detail: HIT }), true);
  assert.strictEqual(TS.evidenceOf({ verify: { sent: true }, args: { action: 'type_text', text: 'x', submit: true } }), true);
  assert.strictEqual(TS.evidenceOf({ status: 'refused' }), null);
});

const Q = { vi: 'mở Notepad và gõ "hello world"', en: 'open Notepad and type "hello world"', zh: '打开记事本并输入 "hello world"' };

test('B192: #59 — gõ hai lần không thấy chữ, bấm menu vẫn ok, câu cuối hỏi lại → failed chứ không done', async () => {
  // Bản desktop-agent cũ: không có typedSeen, chỉ có câu "CHƯA thấy chữ vừa gõ", bước bấm thì ok.
  const old = (n, a) => a.action === 'type_text'
    ? { forModel: `Đã gõ "${a.text}".\nKiểm tra: ${MISS}`, summary: `gõ “${a.text}”` }
    : { forModel: 'Đã bấm "Edit".\nKiểm tra: Màn hình đã thay đổi sau thao tác.', summary: 'bấm Edit' };
  const replies = [
    call('screen_act', { action: 'type_text', text: 'hello world' }),
    call('screen_act', { action: 'type_text', text: 'hello world' }),
    call('screen_act', { action: 'click', element: 'Edit' }),
    say('Chữ không xuất hiện trong Notepad. Bạn muốn mình làm gì tiếp theo?'),
  ];
  const r = await run(mkAgent(replies, 'vi', old), Q.vi);
  assert.strictEqual(r.outcome, 'failed', r.text);
  assert.ok(r.steps.some(s => s.args && s.args.action === 'click' && s.status === 'ok' && !s.check), 'bước bấm vẫn ok — trước đây đủ để báo done');
  assert.ok(r.steps.filter(s => s.args && s.args.action === 'type_text').every(s => s.check === 'chưa thấy chữ vừa gõ'), 'bước gõ vào vòng thử lại');
  assert.match(r.text, /chưa thấy chữ vừa gõ/);
  assert.doesNotMatch(r.text, /Bạn muốn mình làm gì/);
  const st = QA.statusOf(r, { task: Q.vi });
  assert.strictEqual(st.status, 'failed');
  assert.strictEqual(QA.exitCodeOf(st.status), 2);
});

test('B192 [en/zh]: không thấy chữ → câu thất bại theo ngôn ngữ, không còn tiếng Việt', async () => {
  const exec = (n, a) => actResult(a, TS.textOnScreen(a.text, { uia: '' }));
  for (const lang of ['en', 'zh']) {
    const r = await run(mkAgent([call('screen_act', { action: 'type_text', text: 'hello world' }), say('Done.')], lang, exec), Q[lang]);
    assert.strictEqual(r.outcome, 'failed', r.text);
    assert.ok(!VI.test(r.text), r.text);
    assert.match(r.text, lang === 'en' ? /the text just typed is not visible/ : /没有看到刚刚输入的文字/);
  }
});

test('B192: không gõ được chữ nào → failed', async () => {
  const exec = (n, a) => actResult(a, TS.textOnScreen(a.text, { uia: '', ocr: '', vision: '' }));
  const r = await run(mkAgent([call('screen_act', { action: 'type_text', text: 'hello world' }), say('Đã gõ xong.')], 'vi', exec), Q.vi);
  const step = typeStep(r);
  assert.strictEqual(r.outcome, 'failed', r.text);
  assert.ok(step, 'có bước gõ');
  assert.strictEqual(step.status, 'error');
  assert.strictEqual(step.typedSeen.ok, false);
  assert.match(r.text, /chưa thấy chữ vừa gõ/);
  assert.doesNotMatch(r.text, /Đã gõ xong/);
});

test('B192: chữ đã gõ và đang hiện → done', async () => {
  const exec = (n, a) => actResult(a, TS.textOnScreen(a.text, { uia: 'hello world' }));
  const r = await run(mkAgent([call('screen_act', { action: 'type_text', text: 'hello world' }), say('Đã gõ “hello world” vào Notepad.')], 'vi', exec), Q.vi);
  const step = typeStep(r);
  assert.strictEqual(r.outcome, 'done', r.text);
  assert.strictEqual(step.status, 'ok');
  assert.strictEqual(step.typedSeen.ok, true);
  assert.strictEqual(step.typedSeen.via, 'uia');
  assert.strictEqual(QA.statusOf(r, { task: Q.vi }).status, 'done');
});

test('B192: chữ dài chỉ hiện một phần (đuôi) → done', async () => {
  const exec = (n, a) => actResult(a, TS.textOnScreen(a.text, { ocr: LONG.slice(-TS.TAIL) }));
  const r = await run(mkAgent([call('screen_act', { action: 'type_text', text: LONG }), say('Đã gõ đoạn dài.')], 'vi', exec), 'mở Notepad và gõ một đoạn dài');
  const step = typeStep(r);
  assert.strictEqual(r.outcome, 'done', r.text);
  assert.strictEqual(step.typedSeen.part, 'tail');
  assert.strictEqual(step.typedSeen.via, 'ocr');
});

test('B192: chữ tiếng Việt có dấu (NFC trên màn hình, kể cả bản không dấu của OCR) → done', async () => {
  const exec = (n, a) => actResult(a, TS.textOnScreen(a.text, { uia: VI_TEXT.normalize('NFC') }));
  let r = await run(mkAgent([call('screen_act', { action: 'type_text', text: VI_TEXT }), say('Đã gõ dòng họp.')], 'vi', exec), 'mở Notepad và gõ dòng họp');
  assert.strictEqual(r.outcome, 'done', r.text);
  const execOcr = (n, a) => actResult(a, TS.textOnScreen(a.text, { ocr: 'Hop luc 8 gio, nho mang tai lieu.' }));
  r = await run(mkAgent([call('screen_act', { action: 'type_text', text: VI_TEXT }), say('Đã gõ dòng họp.')], 'vi', execOcr), 'mở Notepad và gõ dòng họp');
  assert.strictEqual(r.outcome, 'done', r.text);
  assert.strictEqual(typeStep(r).typedSeen.via, 'ocr');
});

test('B192: ảnh che vì bí mật + chỉ có OCR → failed; cùng ảnh che nhưng UIA có chữ → done', async () => {
  const blankOcr = (n, a) => actResult(a, TS.textOnScreen(a.text, { ocr: a.text, vision: a.text, shotBlanked: true }));
  let r = await run(mkAgent([call('screen_act', { action: 'type_text', text: 'hello world' }), say('Đã gõ xong.')], 'vi', blankOcr), Q.vi);
  assert.strictEqual(r.outcome, 'failed', r.text);
  const blankUia = (n, a) => actResult(a, TS.textOnScreen(a.text, { uia: a.text, ocr: a.text, shotBlanked: true }));
  r = await run(mkAgent([call('screen_act', { action: 'type_text', text: 'hello world' }), say('Đã gõ “hello world”.')], 'vi', blankUia), Q.vi);
  assert.strictEqual(r.outcome, 'done', r.text);
  assert.strictEqual(typeStep(r).typedSeen.via, 'uia');
});

test('B192: việc chỉ bấm, không gõ, vẫn done (không có bước gõ để đòi bằng chứng)', async () => {
  const exec = (n, a) => actResult(a, { ok: false, via: null, why: 'not-seen' });
  const r = await run(mkAgent([call('screen_act', { action: 'click', element: 'Bật' }), say('Đã bấm nút Bật.')], 'vi', exec), 'mở Cài đặt và bấm nút Bật');
  assert.strictEqual(r.outcome, 'done', r.text);
});

test('B192: desktop-agent nhìn lại có hạn và agent không chốt done khi bước gõ thiếu bằng chứng', () => {
  const da = fs.readFileSync(path.join(__dirname, '../src/desktop-agent.js'), 'utf8');
  const ag = fs.readFileSync(path.join(__dirname, '../src/agent/agent.js'), 'utf8');
  assert.match(da, /TS\.confirmTyped\(/);
  assert.match(da, /looks: TS\.LOOKS/);
  assert.match(da, /shotBlanked: shotBlank\(\)/);
  assert.match(da, /error: 'chưa thấy chữ vừa gõ'/);
  assert.match(ag, /typedSeen: out\.typedSeen/);
  assert.match(ag, /taskWritesOk\(steps\)/);
  assert.strictEqual(TS.LOOKS, 3);
});
