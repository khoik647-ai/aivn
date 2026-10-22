'use strict';
// B171 (UI): thẻ lỗi hiện bước nào hỏng, lỗi gì, cách xử lý; dòng/thẻ lỗi giống nhau liên tiếp gộp một, kèm số lần.
// Không đổi vòng lặp thử lại — chỉ cách hiện lỗi đã có (summary, detail, check, error).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const EV = require('../src/renderer/error-view');
const T = require('../src/i18n/core').create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const SKIP = 'bỏ qua — cách này đã hỏng 2 lần, cần đổi cách';
const WHY = '(Kiểm tra tự động của AIVN) KHÔNG làm lại: click "Gửi" đã thử 2 lần và đều chưa có tác dụng (không thấy phần tử). Hãy đổi cách: cuộn.';
function errStep(over) {
  return Object.assign({ id: 's', status: 'error', label: 'Thao tác màn hình', name: 'screen_act', icon: '🖱', summary: SKIP, detail: WHY, args: { action: 'click', element: 'Gửi' }, ms: 100 }, over);
}

test('B171: bốn thẻ lỗi giống nhau liên tiếp gộp một; khác đích hoặc xen bước thường thì không gộp', () => {
  const same = [1, 2, 3, 4].map(i => errStep({ id: 'e' + i, ms: 100 }));
  const g = EV.groupSteps(same);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].kind, 'err');
  assert.strictEqual(g[0].count, 4);
  assert.strictEqual(g[0].ms, 400);
  assert.strictEqual(g[0].steps.length, 4);
  const split = EV.groupSteps([errStep({ id: 'a' }), { id: 'ok', status: 'ok', label: 'Xem màn hình', summary: 'đã chụp', args: {} }, errStep({ id: 'b' })]);
  assert.deepStrictEqual(split.map(x => x.kind), ['err', 'step', 'err']);
  assert.strictEqual(split[0].count, 1);
  assert.strictEqual(split[2].count, 1);
  const diff = EV.groupSteps([errStep({ id: 'a', args: { action: 'click', element: 'Gửi' } }), errStep({ id: 'b', args: { action: 'click', element: 'Huỷ' } })]);
  assert.strictEqual(diff.length, 2);
  const okSkip = { id: 'z', status: 'ok', label: 'Thao tác màn hình', summary: SKIP, detail: WHY, args: { action: 'click', element: 'Gửi' } };
  assert.strictEqual(EV.isErrorStep(okSkip), false);
  assert.strictEqual(EV.groupSteps([okSkip])[0].kind, 'step');
});

test('B171: lỗi cụ thể lấy từ check hoặc từ chi tiết; câu chung “Quá tải số lần retry/lỗi” đổi thành lời thường và cách xử lý', () => {
  assert.strictEqual(EV.plainError(errStep()), 'không thấy phần tử');
  assert.strictEqual(EV.plainError(errStep({ check: 'chưa thấy chữ vừa gõ', detail: '' })), 'chưa thấy chữ vừa gõ');
  assert.strictEqual(EV.plainError(errStep({ error: 'cách này đã thử 2 lần không có tác dụng', check: 'hộp thoại vẫn đang mở' })), 'hộp thoại vẫn đang mở');
  const generic = { status: 'error', label: 'Thao tác màn hình', summary: 'Quá tải số lần retry/lỗi', detail: '', args: {} };
  assert.strictEqual(EV.plainError(generic), EV.PLAIN_RETRY);
  assert.strictEqual(EV.fixFor('Quá tải số lần retry/lỗi'), EV.FIX_RETRY);
  assert.strictEqual(EV.fixFor('không thấy phần tử'), 'Quan sát lại màn hình rồi bấm đúng chỗ. Nếu nút nằm ngoài khung, hãy cuộn tới nó.');
  assert.strictEqual(EV.fixFor('chưa kiểm chứng được là đã gửi'), 'Mở đúng cuộc trò chuyện và kiểm tra tin đã hiện chưa, rồi mới gửi lại.');
  assert.strictEqual(EV.fixFor('không rõ lỗi lạ'), EV.FIX_DEFAULT);
  assert.strictEqual(EV.actionWhat(errStep()).verb, 'bấm');
  assert.strictEqual(EV.actionWhat(errStep()).target, 'Gửi');
});

test('B171: thẻ lỗi hiện tên bước, thao tác, đích, lỗi và cách xử lý; số lần chỉ khi lặp', () => {
  const g = EV.groupSteps([1, 2, 3, 4].map(i => errStep({ id: 'e' + i })))[0];
  const html = EV.errorCardHtml(g, { fmtMs: (ms) => ms + ' ms' });
  for (const s of ['Bước lỗi', 'Thao tác màn hình', 'bấm', 'Gửi', 'không thấy phần tử', 'Cách xử lý', 'Quan sát lại màn hình', 'đã lặp 4 lần', 'role="alert"', 'data-noi18n']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes(SKIP), 'không hiện lại câu chung đã được giải nghĩa');
  const one = EV.errorCardHtml(EV.groupSteps([errStep()])[0]);
  assert.ok(!one.includes('đã lặp'));
  const esc = EV.errorCardHtml({ kind: 'err', count: 1, st: errStep({ args: { action: 'click', element: 'a<b & c' } }) });
  assert.ok(esc.includes('a&lt;b &amp; c'));
  assert.ok(!esc.includes('a<b'));
});

test('B171: dòng lỗi giống nhau liên tiếp gộp kèm ×N; câu thường lặp lại thì giữ nguyên', () => {
  const hi = 'xin chào\nxin chào\nxin chào';
  assert.strictEqual(EV.collapseErrorLines(hi), hi);
  assert.strictEqual(EV.collapseErrorLines('Lỗi: hết giờ\nLỗi: hết giờ\nLỗi: hết giờ'), 'Lỗi: hết giờ ×3');
  assert.strictEqual(EV.collapseErrorLines('⚠ Quá tải số lần retry/lỗi\n⚠ Quá tải số lần retry/lỗi\nQuá tải số lần retry'), '⚠ Quá tải số lần retry/lỗi ×2\nQuá tải số lần retry');
  assert.strictEqual(EV.collapseErrorLines(SKIP + '\n' + SKIP), SKIP + ' ×2');
});

test('B171: khi đã có thẻ giải thích thì bỏ câu chung khỏi phần trả lời; không có bước lỗi thì một thẻ “Không rõ bước”', () => {
  const body = 'Đã mở Zalo.\nQuá tải số lần retry/lỗi\nQuá tải số lần retry/lỗi\nBạn xem lại giúp mình.';
  const shown = EV.presentBody(body, [errStep()]);
  assert.ok(shown.includes('Đã mở Zalo.'));
  assert.ok(shown.includes('Bạn xem lại giúp mình.'));
  assert.ok(!/retry/i.test(shown));
  assert.strictEqual(EV.orphanGroup(body, [errStep()]), null);
  const only = 'Quá tải số lần retry/lỗi\nQuá tải số lần retry/lỗi\nQuá tải số lần retry/lỗi';
  assert.strictEqual(EV.presentBody(only, []), '');
  const o = EV.orphanGroup(only, []);
  assert.strictEqual(o.count, 3);
  assert.strictEqual(o.st.label, 'Không rõ bước');
  assert.strictEqual(EV.plainError(o.st), EV.PLAIN_RETRY);
  assert.strictEqual(EV.presentBody('xin chào\nxin chào', []), 'xin chào\nxin chào');
});

test('B171: chữ mới có bản en/zh, kể cả lý do kiểm tra hiện trên thẻ', () => {
  for (const [vi, en, zh] of [
    ['Bước lỗi', 'Failed step', '失败的步骤'],
    ['đã lặp 4 lần', 'repeated 4 times', '已重复 4 次'],
    ['Đã thử lại quá nhiều lần mà bước này vẫn lỗi.', 'This step was retried too many times and still failed.', '这一步重试太多次，仍然失败。'],
    ['không thấy phần tử', 'element not found', '未找到该元素'],
    ['Cách xử lý', 'What to try', '可以这样处理'],
    ['bấm đúp', 'double-click', '双击'],
  ]) { assert.strictEqual(T.tr(vi, 'en'), en); assert.strictEqual(T.tr(vi, 'zh'), zh); }
});

test('B171: giao diện nối thẻ lỗi và gộp dòng; slimStep chuyển tiếp check/error; vòng lặp thử lại không gọi module này', () => {
  const app = rd('src/renderer/app.js');
  for (const s of ['groupSteps', 'presentBody', 'orphanGroup', 'errorCardHtml', 'agentBody', 'errNoteHtml']) assert.ok(app.includes(s), s);
  const html = rd('src/renderer/index.html');
  assert.ok(html.indexOf('src="error-view.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="i18n-dom.js"') < html.indexOf('src="error-view.js"'));
  const main = rd('src/main.js');
  assert.match(main, /check: x\.check \|\| undefined, error: x\.error \? String\(x\.error\)\.slice\(0, 400\)/);
  const agent = rd('src/agent/agent.js');
  assert.match(agent, /retry\.before\(args, rctx\)/);
  assert.match(agent, /retry\.after\(args, out, rctx\)/);
  assert.ok(!agent.includes('error-view'));
  assert.ok(!rd('src/agent/retry.js').includes('error-view'));
});
