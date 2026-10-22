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

const VI_MARK = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
function cardLines(html) {
  return html.replace(/<span data-noi18n>[\s\S]*?<\/span>/gi, ' ').replace(/<[^>]+>/g, '\n').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
test('B171: lỗi đường dẫn sai gợi ý kiểm tra đường dẫn, tên tệp và thư mục được phép', () => {
  const raw = 'Không tìm thấy "khong-ton-tai/bao-cao.txt" trong thư mục được phép.';
  const step = { status: 'error', label: 'Đọc tệp', name: 'read_file', icon: '📖', summary: raw, error: raw, args: { path: 'khong-ton-tai/bao-cao.txt' }, ms: 3 };
  const said = EV.plainError(step);
  assert.strictEqual(said, 'Không tìm thấy tệp “khong-ton-tai/bao-cao.txt” trong thư mục được phép.');
  assert.strictEqual(EV.fixFor([said, raw].join('\n')), EV.FIX_PATH);
  assert.ok(EV.FIX_PATH.includes('đường dẫn') && EV.FIX_PATH.includes('tên tệp') && EV.FIX_PATH.includes('thư mục được phép'));
  assert.notStrictEqual(EV.fixFor(raw), EV.FIX_DEFAULT);
  const near = 'Không tìm thấy "khong-ton-tai/bao-cao.txt" trong thư mục được phép. Có tệp tên gần giống: "bao-cao.txt" — nếu đúng là tệp này thì gọi lại với đúng tên đó.';
  assert.strictEqual(EV.spokenError(near), 'Không tìm thấy tệp “khong-ton-tai/bao-cao.txt” trong thư mục được phép. Có tệp tên gần giống: “bao-cao.txt”.');
  assert.strictEqual(EV.spokenError('Không tìm thấy "bao-cao.txt".'), 'Không tìm thấy tệp “bao-cao.txt”.');
  assert.strictEqual(EV.spokenError('Từ chối truy cập (Access denied): "C:/ngoai/a.txt" nằm ngoài các thư mục người dùng cho phép. AIVN AGENT chỉ được làm việc trong: /home/a.'), 'Tệp “C:/ngoai/a.txt” nằm ngoài thư mục được phép.');
  assert.strictEqual(EV.spokenError('Chưa có thư mục nào được cho phép. Người dùng cần thêm thư mục trong Cài đặt AIVN AGENT.'), 'Chưa có thư mục được phép. Hãy thêm thư mục trong Cài đặt AIVN AGENT.');
  assert.strictEqual(EV.spokenError('Tham số đường dẫn phải là tên/đường dẫn tệp (vd. chi-tieu.csv), không phải nội dung tệp.'), 'Hãy ghi đường dẫn hoặc tên tệp, không ghi nội dung tệp.');
  assert.strictEqual(EV.spokenError('"ghi-chu" là thư mục. Dùng list_files để xem bên trong.'), '“ghi-chu” là thư mục, không phải tệp.');
  assert.strictEqual(EV.fixFor('không thấy phần tử'), 'Quan sát lại màn hình rồi bấm đúng chỗ. Nếu nút nằm ngoài khung, hãy cuộn tới nó.');
});

test('B171: câu lỗi en/zh lấy trọn từ bảng ngôn ngữ, không sót dấu tiếng Việt', () => {
  const samples = [
    { status: 'error', label: 'Đọc tệp', name: 'read_file', summary: 'Không tìm thấy "khong-ton-tai/bao-cao.txt" trong thư mục được phép.', error: 'Không tìm thấy "khong-ton-tai/bao-cao.txt" trong thư mục được phép.', args: { path: 'khong-ton-tai/bao-cao.txt' }, ms: 3 },
    { status: 'error', label: 'Đọc tệp', name: 'read_file', summary: 'Không tìm thấy "khong-ton-tai/bao-cao.txt" trong thư mục được phép. Có tệp tên gần giống: "bao-cao.txt" — nếu đúng là tệp này thì gọi lại với đúng tên đó.', error: 'Không tìm thấy "khong-ton-tai/bao-cao.txt" trong thư mục được phép. Có tệp tên gần giống: "bao-cao.txt" — nếu đúng là tệp này thì gọi lại với đúng tên đó.', args: { path: 'khong-ton-tai/bao-cao.txt' } },
    { status: 'error', label: 'Đọc tệp', summary: 'Không tìm thấy "bao-cao.txt".', error: 'Không tìm thấy "bao-cao.txt".', args: { path: 'bao-cao.txt' } },
    { status: 'error', label: 'Đọc tệp', summary: 'Từ chối truy cập (Access denied): "C:/ngoai/a.txt" nằm ngoài các thư mục người dùng cho phép.', error: 'Từ chối truy cập (Access denied): "C:/ngoai/a.txt" nằm ngoài các thư mục người dùng cho phép.', args: { path: 'C:/ngoai/a.txt' } },
    { status: 'error', label: 'Xem thư mục', summary: 'Chưa có thư mục nào được cho phép. Người dùng cần thêm thư mục trong Cài đặt AIVN AGENT.', error: 'Chưa có thư mục nào được cho phép. Người dùng cần thêm thư mục trong Cài đặt AIVN AGENT.', args: {} },
    { status: 'error', label: 'Đọc tệp', summary: 'Tham số đường dẫn phải là tên/đường dẫn tệp (vd. chi-tieu.csv), không phải nội dung tệp.', error: 'Tham số đường dẫn phải là tên/đường dẫn tệp (vd. chi-tieu.csv), không phải nội dung tệp.', args: { path: 'dong 1, dong 2' } },
    { status: 'error', label: 'Đọc tệp', summary: '"ghi-chu" là thư mục. Dùng list_files để xem bên trong.', error: '"ghi-chu" là thư mục. Dùng list_files để xem bên trong.', args: { path: 'ghi-chu' } },
    errStep(),
  ];
  for (const st of samples) {
    const g = EV.groupSteps([1, 2, 3, 4, 5].map(i => Object.assign({}, st, { id: 'e' + i, ms: 3 })))[0];
    const html = EV.errorCardHtml(g, { fmtMs: (ms) => ms + ' ms' });
    for (const lang of ['en', 'zh']) {
      for (const line of cardLines(html)) {
        const out = T.tr(line, lang);
        assert.ok(!VI_MARK.test(out), lang + ' còn tiếng Việt trong “' + out + '” (gốc: ' + line + ')');
      }
    }
  }
  const leaked = T.tr('Không tìm thấy "khong-ton-tai/bao-cao.txt" trong thư mục được phép', 'zh');
  assert.match(leaked, /Không tìm thấy/);
  const full = T.tr('Không tìm thấy tệp “khong-ton-tai/bao-cao.txt” trong thư mục được phép.', 'en');
  assert.strictEqual(full, 'Could not find the file “khong-ton-tai/bao-cao.txt” in an allowed folder.');
  assert.strictEqual(T.tr('Không tìm thấy tệp “khong-ton-tai/bao-cao.txt” trong thư mục được phép.', 'zh'), '在允许的文件夹里找不到文件“khong-ton-tai/bao-cao.txt”。');
  assert.strictEqual(T.tr(EV.FIX_PATH, 'en'), 'Check the path, the file name, and whether that folder is in the allowed folders.');
  assert.strictEqual(T.tr(EV.FIX_PATH, 'zh'), '请检查路径、文件名，以及该文件夹是否在允许的文件夹中。');
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
