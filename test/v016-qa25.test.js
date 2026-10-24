'use strict';
// QA máy thật beta.2.5 (22/10, DESKTOP-2G546S3): B107–B117
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const SV = require('../src/agent/send-verify');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('B113: “báo cho mình / cho tôi / tell me / report back / 告诉我” = trả lời trong AIVN, không hỏi “Gửi cho ai?”', () => {
  const self = [
    'mở Chrome tìm "giá vàng SJC hôm nay", mở kết quả đầu tiên rồi báo cho mình giá và đường dẫn trang', // đúng câu kịch bản A trong ghi chú phát hành
    'mở Chrome tìm "thời tiết TP.HCM hôm nay", mở kết quả đầu tiên rồi báo cho mình nhiệt độ và đường dẫn trang',
    'tìm giá xăng hôm nay rồi báo cho tôi biết giá', 'tìm giá vàng rồi cho mình biết giá', 'mở trang thoitiet.vn rồi báo lại cho mình nhé',
    'open Chrome, search the weather in Hanoi and tell me the temperature and the page link', 'search the gold price and report back with the link',
    'look up the exchange rate and let me know', '打开 Chrome 搜索今天的天气，然后告诉我温度和网址',
  ];
  for (const q of self) { assert.strictEqual(SV.msgSend(q), false, q); assert.strictEqual(SV.missingRecipient(q), false, q); }
  // vẫn là gửi tin khi nêu ứng dụng nhắn tin / người nhận
  assert.ok(SV.missingRecipient('báo cho mình giá vàng qua Zalo'));
  assert.ok(SV.missingRecipient('nhắn giúp mình là mai 8h họp nhé'));
  assert.ok(SV.msgSend('tìm giá vàng rồi nhắn cho Lan trên Zalo')); assert.strictEqual(SV.recipientOf('tìm giá vàng rồi nhắn cho Lan trên Zalo'), 'Lan');
  assert.ok(SV.msgSend('báo cho Lan biết mai nghỉ'));
  // desktop-agent/agent dùng msgSend (đã bỏ phần báo-cho-mình), không dùng MSG_SEND thô
  assert.doesNotMatch(src('src/desktop-agent.js'), /SV\.MSG_SEND\.test/); assert.doesNotMatch(src('src/agent/agent.js'), /MSG_SEND\.test/);
});

test('B110: gì/ai/không gửi gì không bao giờ là tên người nhận; mở chat X lấy đúng X', () => {
  const cases = [
    ['mở Zalo rồi mở cuộc trò chuyện Cloud của tôi, không gửi gì', 'Cloud của tôi'],
    ['mở Zalo và mở chat Cloud của tôi', 'Cloud của tôi'],
    ['mở Zalo và mở chat Cloud của tôi, đừng gửi gì cả', 'Cloud của tôi'],
    ["open Zalo and open the chat with Cloud của tôi, don't send anything", 'Cloud của tôi'],
    ['打开 Zalo 打开和 Lan 的聊天，不要发送任何消息', 'Lan'],
    ['mở cuộc trò chuyện với Trần Quỳnh Anh trên Zalo rồi nhắn "hi"', 'Trần Quỳnh Anh'],
    ['nhắn Trần Quỳnh Anh là mai họp', 'Trần Quỳnh Anh'],
    ['gửi tin "hi" cho Lan trên Zalo', 'Lan'],
  ];
  for (const [q, r] of cases) assert.strictEqual(SV.recipientOf(q), r, q);
  for (const q of ['gửi gì cho ai đó', 'nhắn gì', 'mở chat hiện tại rồi gửi "x"', 'không gửi gì', 'đừng nhắn ai cả', "don't send anything"]) assert.strictEqual(SV.recipientOf(q), null, q);
});

test('B108: nội dung bước gửi/gõ vào ô soạn phải lấy từ yêu cầu (ngoặc kép hoặc nói rõ)', () => {
  const ok = [['gửi tin "AIVN test beta.2.5 – bỏ qua" cho Cloud của tôi trên Zalo', 'AIVN test beta.2.5 – bỏ qua'], ['gửi tin "AIVN test" cho Lan', 'AIVN test\n'],
    ['nhắn Trần Quỳnh Anh là mai 8h họp nhé', 'Mai 8h họp nhé!'], ['gửi tin nhắn chúc buổi sáng ở zalo cho trần quỳnh anh', 'Chào buổi sáng!'], ['给王老师发消息说明天开会', '明天开会']];
  for (const [q, t] of ok) assert.ok(SV.textFromRequest(q, t), `${q} → ${t}`);
  const bad = [['mở Zalo và mở chat Cloud của tôi', 'Chào bạn!'], ['mở Zalo và mở chat Cloud của tôi', '@My Documents'], ['nhắn Lan là mai 8h họp', 'Chào Lan, hôm nay đi chơi không?'], ['给王老师发消息说明天开会', '你好'], ['gửi tin "AIVN b108 bốn" cho Cloud của tôi', 'Chào bạn, mình gửi bạn tin nhắn nhé']];
  for (const [q, t] of bad) assert.ok(!SV.textFromRequest(q, t), `${q} → ${t}`);
  const s = src('src/desktop-agent.js');
  assert.match(s, /Chặn gõ \(B108\)/); assert.match(s, /Chặn bước GỬI \(B108\)/);
  // chốt chặn bước GỬI nằm TRƯỚC thẻ xin phép gửi (B70 chặn gửi lại là đoạn đầu của khối thẻ)
  assert.ok(s.indexOf('Chặn bước GỬI (B108)') < s.indexOf('Chặn gửi lại (B70)'));
  // open_chat cho việc chỉ mở chat: không gợi ý gõ/gửi; tên gõ nhầm vào ô soạn → xoá, không Enter
  assert.match(s, /Việc chỉ là MỞ cuộc trò chuyện: ĐÃ XONG\. KHÔNG gõ gì/); assert.match(s, /đã vào Ô SOẠN TIN \(ô tìm kiếm chưa mở\) — đã xoá, không bấm Enter/);
  assert.doesNotMatch(s, /'Bước tiếp: type_text NỘI DUNG tin/);
});

test('B109: ô tìm kiếm đọc qua OCR có nhiễu/mất dấu vẫn là ô TÌM KIẾM (không bị cổng B90 chặn); không nhầm tên người', () => {
  const { SEARCHY_ANY } = require('../src/desktop-agent');
  for (const x of ['Q Tim kiếm', 'Q Tìm kiếm', '[Tim kiếm trên Messenger', '| Tìm kiếm', 'Tìm kiếm', 'Search', '搜索']) assert.ok(SEARCHY_ANY.test(x), x);
  for (const x of ['Tim Cook', 'Timothy', 'My Documents', 'Nhập @, tin nhắn tới My Documents', 'Trần Quỳnh Anh']) assert.ok(!SEARCHY_ANY.test(x), x);
  const AG = require('../src/agent/agent');
  for (const q of ['mở Zalo và mở chat Cloud của tôi', 'mở Zalo rồi mở cuộc trò chuyện Cloud của tôi, không gửi gì', 'open Zalo and open the chat with Lan', '打开 Zalo 打开和 Lan 的聊天']) assert.ok(AG.openChatTask(q), q);
  for (const q of ['gửi tin "x" vào cuộc trò chuyện hiện tại', 'mở Chrome tìm "giá vàng"']) assert.ok(!AG.openChatTask(q), q);
  const a = src('src/agent/agent.js'); assert.match(a, /open_chat tự động/); assert.match(a, /đã khởi động\|từ khay/);
});

test('B111: mở chat chỉ XONG khi tiêu đề khớp; “Không tìm thấy…” không bao giờ là done', () => {
  const AG = require('../src/agent/agent'); const Q = require('../src/qa-runner');
  assert.ok(AG.chatVerifiedStep({ name: 'screen_act', status: 'ok', detail: 'Cuộc trò chuyện với “Cloud của tôi” đang mở sẵn (đã kiểm tiêu đề).' }));
  assert.ok(AG.chatVerifiedStep({ name: 'screen_act', status: 'ok', detail: 'Đã bấm …\nKiểm tra: Đã mở cuộc trò chuyện với “Lan” (thấy đúng tên trên màn hình).' }));
  assert.ok(!AG.chatVerifiedStep({ name: 'screen_act', status: 'ok', detail: 'Đã bấm kết quả “Lan”; chưa đọc được tiêu đề' }));
  assert.ok(!AG.chatVerifiedStep({ name: 'ensure_app', status: 'ok', detail: 'Zalo sẵn sàng' }));
  const task = 'mở Zalo rồi mở cuộc trò chuyện Cloud của tôi, không gửi gì';
  for (const t of ['Không tìm thấy cuộc trò chuyện tên "Cloud" trong Zalo.', 'I could not find that chat.', '找不到这个聊天。']) assert.strictEqual(Q.statusOf({ outcome: 'done', text: t, steps: [{ status: 'ok' }] }, { task }).status, 'failed', t);
  assert.match(src('src/agent/agent.js'), /B111: việc mở cuộc trò chuyện nhưng chưa có bước nào kiểm tiêu đề khớp người nhận/);
  // tiêu đề có biểu tượng OCR “Q My Documents” vẫn khớp (tên mới của Cloud của tôi)
  assert.ok(SV.chatShown('Cloud của tôi', 'Zalo', ['Q My Documents']));
  assert.ok(!SV.chatShown('Cloud của tôi', 'Zalo', ['Nhóm Lớp K27']));
});

test('B112: việc CHỈ SOẠN — “chưa gửi đi” là thành công; xong khi kiểm thấy chữ trong Ô SOẠN, không dùng phép kiểm ô tìm kiếm', () => {
  const Q = require('../src/qa-runner');
  const task = 'soạn sẵn tin nhắn cho Cloud của tôi trên Zalo: "AIVN nháp beta.2.5 – bỏ qua", chỉ soạn đừng gửi';
  const t = 'Đã soạn sẵn tin nhắn “AIVN nháp beta.2.5 – bỏ qua” trong Zalo cho My Documents. Tin nhắn đã được nhập và hiển thị rõ ràng trong khung chat, nhưng chưa gửi đi.';
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: t, steps: [{ draftIn: { text: 'x' } }] }, { draft: true, task }).status, 'done');
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Draft typed, not sent yet.', steps: [{ draftIn: {} }] }, { draft: true, task }).status, 'done');
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: t, steps: [{}] }, { draft: true, task }).status, 'failed', 'không kiểm thấy chữ trong ô soạn');
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: t, steps: [{ draftIn: {}, verify: { sent: true } }] }, { draft: true, task }).status, 'failed', 'chỉ soạn mà đã gửi');
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Mình không thể mở Zalo.', steps: [{ draftIn: {} }] }, { draft: true, task }).status, 'failed');
  // việc gửi (không phải chỉ soạn) nói “chưa gửi được” vẫn là thất bại
  assert.strictEqual(Q.statusOf({ outcome: 'done', text: 'Mình chưa gửi được tin.', steps: [] }, { task: 'gửi tin "x" cho Lan trên Zalo' }).status, 'failed');
  const s = src('src/desktop-agent.js'); assert.match(s, /&& !\(bodyTyping && landed !== 'wrong'\); \/\/ B112/); assert.match(s, /draftIn = \{ text:/);
  assert.match(src('src/agent/agent.js'), /draftIn: out\.draftIn/);
});

test('B107: chọn CUDA theo `--list-devices` (không theo mức log); không thấy GPU NVIDIA → không nạp hai lần; -lv 4 để có gpuLayers; Vulkan mặc định', async () => {
  const V = require('../src/vision-server'); const os = require('os');
  // đúng dòng QA thấy trên máy thật (b11751, RTX 4070 SUPER)
  const d = V.parseDevices('ggml_cuda_init: found 1 CUDA devices (Total VRAM: 12281 MiB):\nAvailable devices:\n  CUDA0: NVIDIA GeForce RTX 4070 SUPER (12281 MiB, 11071 MiB free)\n  Vulkan0: NVIDIA GeForce RTX 4070 SUPER (12281 MiB, 11500 MiB free)');
  assert.deepStrictEqual(d.map(x => x.id), ['CUDA0', 'Vulkan0']); assert.strictEqual(d[0].name, 'NVIDIA GeForce RTX 4070 SUPER'); assert.strictEqual(d[0].totalMiB, 12281);
  if (process.platform !== 'win32') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-b107-'));
    const fake = path.join(dir, 'llama-server'); fs.writeFileSync(fake, '#!/bin/sh\n[ "$1" = "--list-devices" ] && { echo "Available devices:"; echo "  CUDA0: NVIDIA GeForce RTX 4070 SUPER (12281 MiB, 11071 MiB free)"; exit 0; }\nexit 1\n'); fs.chmodSync(fake, 0o755);
    const r = await V.listDevices(fake); assert.ok(r.ok); assert.deepStrictEqual(r.cuda.map(x => x.id), ['CUDA0']);
    // không thấy CUDA → không chạy runtime CUDA (không nạp hai lần), đi thẳng bản đi kèm
    const logs = []; const vs = V.createVisionServer({ log: (m) => logs.push(m) });
    try { await vs.start({ id: 'x', modelPath: '/nonexistent.gguf', serverExe: fake, listDevices: async () => ({ ok: true, cuda: [], all: [{ id: 'Vulkan0' }] }) }); } catch {}
    assert.ok(logs.some(l => /--list-devices không thấy GPU NVIDIA/.test(l)), logs.join('\n')); assert.ok(!logs.some(l => /dùng runtime CUDA/.test(l)), 'không thử CUDA');
    try { await vs.stop(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const s = src('src/vision-server.js'); assert.match(s, /args\.push\('-lv', '4'\)/); assert.match(s, /offloaded \(\\d\+\)\\\/\(\\d\+\) layers to GPU/);
  assert.match(src('src/renderer/index.html'), /Mặc định: bản đi kèm \(Vulkan \/ Metal \/ CPU\)/); assert.match(src('src/renderer/index.html'), /86,0 so với 86,4/);
});

// ---------- B114: tìm trên web trong Chrome = tab mới / thanh địa chỉ, không dùng ô tìm kiếm của trang ----------
test('B114: nhận ra việc tìm web trong trình duyệt; link phải từ trang đã mở', () => {
  const D = require('../src/desktop-agent'); const AG = require('../src/agent/agent');
  const A = 'mở Chrome tìm "giá vàng SJC hôm nay", mở kết quả đầu tiên rồi báo cho mình giá và đường dẫn trang';
  const B = 'mở Chrome tìm "thời tiết TP.HCM hôm nay", mở kết quả đầu tiên rồi báo cho mình nhiệt độ và đường dẫn trang';
  for (const q of [A, B]) { assert.ok(D.webSearchTask(q), q); assert.ok(AG.BROWSER_TASK_RE.test(q), q); }
  assert.ok(!D.webSearchTask('tìm video nhạc trên YouTube'), 'tìm trong một trang cụ thể (YouTube) không phải tìm web');
  assert.ok(D.isBrowserWin({ proc: 'chrome.exe', title: 'YouTube - Google Chrome' })); assert.ok(!D.isBrowserWin({ proc: 'Zalo.exe', title: 'Zalo' }));
  // không có trang nào đã mở → cảnh báo link chưa đối chiếu; có trang đã mở mà link khác → sửa theo trang đã mở
  const out = AG.withSource('Nhiệt độ 33°C. Nguồn: https://thoitiet.vn/ho-chi-minh', B, []);
  assert.ok(out.includes(AG.SOURCE_UNSEEN_MSG), out);
  const s = src('src/desktop-agent.js'); assert.match(s, /B114/); assert.match(s, /keys: 'ctrl\+t'/);
  assert.match(src('src/agent/agent.js'), /BROWSER_TASK_RE\.test\(query\) && names\.some\(n => n === 'web_search' \|\| n === 'fetch_url'\)/, 'việc làm trong trình duyệt: ẩn web_search/fetch_url');
});

// ---------- B115: thanh tác vụ tự ẩn che ô soạn ----------
test('B115: SHAppBarMessage(ABM_GETSTATE) → tự ẩn; không bấm trong dải đáy; đọc lại sau khi đưa chuột đi', async () => {
  const T = require('../src/agent/taskbar');
  assert.strictEqual(T.parseState('1').autoHide, true); assert.strictEqual(T.parseState('2\r\n').autoHide, false); assert.strictEqual(T.parseState(''), null);
  assert.match(T.PS, /SHAppBarMessage\(4,/); // ABM_GETSTATE = 4
  T._reset(); assert.strictEqual(await T.autoHide({ platform: 'linux' }), false);
  T._reset(); assert.strictEqual(await T.autoHide({ run: () => '3' }), true);
  T._reset(); assert.strictEqual(await T.autoHide({ run: () => '0' }), false);
  T._reset(); assert.strictEqual(await T.autoHide({ run: () => { throw new Error('x'); } }), false);
  T._reset();
  const B = { x: 0, y: 0, width: 2560, height: 1440 };
  // QA: bấm ô soạn ở y≈1408/1440 → dời lên nhưng vẫn trong ô soạn
  const ny = T.safeY(1408, B, [600, 1385, 1200, 46]); assert.ok(ny < 1408 && ny >= 1387, String(ny));
  assert.ok(T.safeY(1408, B, null) < 1408); assert.strictEqual(T.safeY(700, B, null), 700);
  assert.strictEqual(T.safeY(1432, B, [600, 1425, 300, 14]), 1432, '#27: phần tử nằm trọn trong dải đáy — bấm trong khung (1432), không kéo ra 1396 ngoài khung');
  assert.strictEqual(T.safeY(1000, { x: 0, y: 1440, width: 1920, height: 1080 }, null), 1000, 'màn hình thứ hai: tính theo màn hình chứa điểm');
  const s = src('src/desktop-agent.js');
  assert.match(s, /await refocus\(\); await sleep\(250\); await awayFromTaskbar\(\);/, 'phép kiểm B104 đọc lại sau khi đưa chuột ra xa đáy');
  assert.match(s, /TB\.place\(x, y, b, box/);
});
test('B115 (đi kèm): việc CHỈ SOẠN không bao giờ bị phép dọn B104 xoá bản nháp', () => {
  const s = src('src/desktop-agent.js');
  assert.match(s, /if \(clear && s\.ctx && DRAFT_SEND\.test\(String\(s\.ctx\.userQuery \|\| ''\)\)\) \{ res.kept = true; res.cleared = false;/);
  const DS = /soạn sẵn|chưa gửi|đừng gửi|don't send|do not send|draft/iu; // DRAFT_SEND thật được kiểm ở harness b101
  assert.ok(DS.test('soạn sẵn tin nhắn cho Cloud của tôi trên Zalo: "x", chưa gửi'));
});

// ---------- B116: tiêu đề khung chat chỉ lấy từ dải tiêu đề ----------
test('B116: shownChat.header không lấy bong bóng tin / khung xem trước liên kết', () => {
  const QA = ['My Documents', 'https://khoik647-ai.github.io/aivn/#nha-phat-trien', 'AIVN - Chạy Al ngay trên máy tính của bạn', 'AIVN giúp bạn tải và chạy các mô hình ngôn ngữ AI hoàn'];
  assert.deepStrictEqual(SV.cleanHeader(QA), ['My Documents']);
  assert.ok(!SV.headerLike('khoik647-ai.github.io/aivn')); assert.ok(!SV.headerLike('www.example.com')); assert.ok(SV.headerLike('Nhóm Lớp K27')); assert.ok(SV.headerLike('Cloud của tôi'));
  const W = [0, 0, 1920, 1400];
  const els = [{ name: 'Nhập @, tin nhắn tới My Documents', b: [480, 1300, 800, 40] }, { name: 'Q My Documents', b: [480, 20, 300, 30], ocr: true }, { name: 'Lưu và đồng bộ dữ liệu', b: [480, 52, 300, 20], ocr: true },
    { name: 'khoik647-ai.github.io/aivn', b: [700, 140, 500, 24], ocr: true }, { name: 'Lan ơi xem nhé', b: [700, 170, 300, 24], ocr: true }, { name: 'Danh sách', b: [10, 100, 200, 20] }];
  const R = SV.regionsOf({ win: { b: W, proc: 'Zalo-b116' }, elements: els });
  assert.deepStrictEqual(R.header, ['Q My Documents', 'Lưu và đồng bộ dữ liệu']); assert.ok(R.messages.includes('Lan ơi xem nhé'), 'bong bóng nhắc tên người khác → thuộc khung tin');
  assert.deepStrictEqual(SV.cleanHeader(R.header), ['My Documents']);
  // bong bóng nhắc tên “Lan” không làm lệch kiểm tra người nhận
  const v = SV.verifySend({ msg: 'x', recipient: 'Lan', regions: { header: R.header, messages: ['x'], composer: [] }, winTitle: 'Zalo' });
  assert.ok(!v.ok || !v.recipientOk, JSON.stringify(v));
});

// ---------- B117: --timeout là hạn chót cứng ----------
test('B117: sau hạn chót không có thẻ mới; lượt treo vẫn bị cắt; kết quả ghi đúng', async () => {
  const Q = require('../src/qa-runner'); const os = require('os');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b117-'));
  const desk = { fn: null, setBenchAnswer(f) { this.fn = f; } };
  let sawAbort = false; let cardAfter = null;
  const deps = { version: 't', engine: { status: () => ({ loaded: true, id: 'm', path: '/m.gguf' }) }, listModels: () => [], desk, LOG: { log: () => {}, tap: () => () => {} }, deadlineGraceMs: 1000,
    runAgentTurn: async ({ signal }) => { await new Promise(r => setTimeout(r, 450)); sawAbort = signal.aborted && signal.reason === 'timeout';
      cardAfter = desk.fn({ send: true, recipient: 'Cloud của tôi', title: 'Gửi tin', shown: { header: ['My Documents'] } });
      return new Promise(() => {}); } }; // lượt không bao giờ trả về
  const t0 = Date.now();
  const res = await Q.run({ task: 'gửi tin "x" cho Cloud của tôi trên Zalo', out: path.join(d, 'r.json'), timeout: 0.2, approveSendTo: 'Cloud của tôi' }, deps);
  const ms = Date.now() - t0;
  assert.ok(sawAbort); assert.strictEqual(cardAfter.ok, false); assert.ok(cardAfter.cancelled);
  assert.strictEqual(res.approvals.length, 0, 'thẻ sau hạn chót không được tính là đã hiện/cho phép'); assert.strictEqual(res.cancelledAfterDeadline, 1);
  assert.strictEqual(res.approvedSends || 0, 0); assert.strictEqual(res.status, 'failed'); assert.match(res.reason, /hết thời gian/); assert.ok(res.hardStop);
  assert.ok(ms < 3000, 'kết quả ghi ngay sau hạn chót + thời gian dọn: ' + ms);
  assert.ok(fs.existsSync(path.join(d, 'r.json')));
  const s = src('src/desktop-agent.js');
  assert.match(s, /if \(signal && signal\.aborted\) return \{ ok: false, cancelled: true/); assert.match(s, /signal\.addEventListener\('abort', onAbort/); assert.match(s, /\}, ctx\.signal\);/);
});
