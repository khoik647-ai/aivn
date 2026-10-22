// B171 (UI): thẻ lỗi của AIVN AGENT — bước nào hỏng, lỗi gì, cách xử lý bằng lời thường;
// các dòng/thẻ lỗi giống hệt nhau liên tiếp gộp thành một, kèm số lần.
// Không đổi logic thử lại. Chỉ đọc những gì bước đã có (tên, summary, detail, check, error).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AIVN_ERROR_VIEW = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RE_GENERIC = /^(?:quá\s*tải\s+số\s+lần\s+retry(?:\s*\/\s*lỗi)?|bỏ qua — cách này đã hỏng\b.*|cách này đã thử \d+ lần không có tác dụng)\.?$/i;
  const RE_WHY = /chưa có tác dụng \(([^)]{1,180})\)/i;
  const VERB = {
    click: 'bấm', double_click: 'bấm đúp', right_click: 'bấm phải', type_text: 'gõ', hotkey: 'phím tắt',
    scroll: 'cuộn', focus_window: 'chuyển cửa sổ', open_chat: 'mở cuộc trò chuyện', wait: 'chờ', open_app: 'mở ứng dụng',
  };
  const FIX_ELEMENT = 'Quan sát lại màn hình rồi bấm đúng chỗ. Nếu nút nằm ngoài khung, hãy cuộn tới nó.';
  const FIX_TYPE = 'Bấm vào đúng ô nhập rồi gõ lại. Đừng gõ vào nút hay vào ô đã có sẵn chữ.';
  const FIX_SEND = 'Mở đúng cuộc trò chuyện và kiểm tra tin đã hiện chưa, rồi mới gửi lại.';
  const FIX_DIALOG = 'Đóng hộp thoại đang mở, rồi làm lại bước này.';
  const FIX_FIND = 'Kiểm tra lại tên ứng dụng hoặc chữ cần tìm. Nếu cửa sổ đang mở, hãy chọn đúng cửa sổ đó.';
  const FIX_LONG = 'Hãy chia việc thành từng bước ngắn hơn. Nếu máy đang bận, đóng bớt ứng dụng rồi thử lại.';
  const FIX_SETUP = 'Kiểm tra phần cần dùng đã được cài và đã bật trong Cài đặt.';
  const FIX_RETRY = 'Cách vừa rồi không có tác dụng. Hãy thử cách khác, hoặc tự làm bước này rồi giao lại phần còn lại.';
  const FIX_PATH = 'Kiểm tra lại đường dẫn, tên tệp, và xem thư mục đó có nằm trong thư mục được phép không.';
  const FIX_DEFAULT = 'Bạn thử giao lại việc, hoặc chia thành bước ngắn hơn; nếu máy đang bận nhiều, hãy chờ máy rảnh rồi thử lại.';
  const PLAIN_RETRY = 'Đã thử lại quá nhiều lần mà bước này vẫn lỗi.';
  // Câu lỗi đường dẫn/tệp là khoá trọn vẹn (có {0}). Không để mẫu ngắn “{0} thư mục được phép” nuốt nửa câu tiếng Việt.

  const stripCount = (s) => String(s || '').trim().replace(/\s×\d+\s*$/, '').trim();
  function isGenericRetry(s) {
    return RE_GENERIC.test(String(s || '').replace(/^⚠\s*/, '').trim());
  }
  function isErrorLine(s) {
    const t = stripCount(s).replace(/^⚠\s*/, '').trim();
    if (!t) return false;
    if (isGenericRetry(t)) return true;
    if (/^⚠/.test(String(s || '').trim())) return true;
    if (/^lỗi\b/i.test(t)) return true;
    if (/^bỏ qua — cách này đã hỏng/i.test(t)) return true;
    return false;
  }
  function cleanErr(s) {
    return String(s || '').replace(/^\(lặp lại\)\s*/, '').replace(/^\s*⚠?\s*/, '').replace(/^\s*lỗi:\s*/i, '').split(/\s*(?:Bước tiếp|Gợi ý cho mô hình|Không mở trang web|\(Kiểm tra tự động)/)[0].trim().replace(/[.\s]+$/, '');
  }
  function actionWhat(st) {
    const a = (st && st.args) || {};
    const act = String(a.action || '').toLowerCase();
    let target = a.element || a.target || a.window || a.app || a.name || a.path || a.url || a.query || a.keys || '';
    if (!target && a.text) target = String(a.text).slice(0, 40);
    if (!target && act === 'open_app') target = a.name || '';
    const verb = VERB[act] || (st && st.name === 'open_app' ? VERB.open_app : '');
    return { verb, target: target ? String(target).replace(/^\[|\]$/g, '').slice(0, 80) : '' };
  }
  function notInFolder(p, near) {
    if (near) return `Không tìm thấy tệp “${p}” trong thư mục được phép. Có tệp tên gần giống: “${near}”.`;
    return `Không tìm thấy tệp “${p}” trong thư mục được phép.`;
  }
  function notFound(p) { return `Không tìm thấy tệp “${p}”.`; }
  function outsideFolder(p) { return `Tệp “${p}” nằm ngoài thư mục được phép.`; }
  function isDir(p) { return `“${p}” là thư mục, không phải tệp.`; }
  // Đưa lỗi đường dẫn/tệp về đúng một câu có trong bảng ngôn ngữ. Phần tên tệp nằm ở {0}.
  function spokenError(raw) {
    const s = String(raw || '').trim();
    let m = /^Không tìm thấy ["“]([^"”]+)["”] trong thư mục được phép\.?(?:\s*Có tệp tên gần giống:\s*["“]([^"”]+)["”][\s\S]*)?$/i.exec(s);
    if (m) return notInFolder(m[1], m[2]);
    m = /^Không tìm thấy ["“]([^"”]+)["”]\.?$/i.exec(s);
    if (m) return notFound(m[1]);
    m = /["“]([^"”]+)["”]\s*nằm ngoài/i.exec(s);
    if (m && /thư mục/i.test(s)) return outsideFolder(m[1]);
    if (/^chưa có thư mục nào được cho phép/i.test(s)) return 'Chưa có thư mục được phép. Hãy thêm thư mục trong Cài đặt AIVN AGENT.';
    if (/tham số đường dẫn phải là tên|không phải nội dung tệp/i.test(s)) return 'Hãy ghi đường dẫn hoặc tên tệp, không ghi nội dung tệp.';
    m = /^["“]([^"”]+)["”] là thư mục\b/i.exec(s);
    if (m) return isDir(m[1]);
    return s;
  }
  function plainError(st) {
    st = st || {};
    const bits = [st.error, st.check].map(cleanErr).filter(x => x && !isGenericRetry(x));
    let raw = bits.length ? bits[0] : '';
    if (!raw) {
      const detail = String(st.detail || '');
      const m = RE_WHY.exec(detail);
      if (m) { const w = cleanErr(m[1]); if (w && !isGenericRetry(w)) raw = w; }
      if (!raw && /^lỗi:\s*\S/i.test(detail)) { const w = cleanErr(detail.split('\n')[0]); if (w && !isGenericRetry(w)) raw = w; }
    }
    if (!raw) { const summary = cleanErr(st.summary); if (summary && !isGenericRetry(summary)) raw = summary; }
    if (!raw) return PLAIN_RETRY;
    const spoken = spokenError(raw);
    return spoken === raw ? spoken.slice(0, 240) : spoken;
  }
  function fixFor(text) {
    const t = String(text || '');
    if (/không thấy phần tử|id không còn|id đổi nhãn/i.test(t)) return FIX_ELEMENT;
    if (/chưa thấy chữ vừa gõ|vào nhầm ô|không gõ|đã gõ chữ này|ô soạn|không phải ô/i.test(t)) return FIX_TYPE;
    if (/chưa kiểm chứng|người nhận|gửi nhầm|chưa gửi/i.test(t)) return FIX_SEND;
    if (/hộp thoại vẫn đang mở/i.test(t)) return FIX_DIALOG;
    if (/kết quả tìm|không thấy cửa sổ|chưa mở được|chưa cài|không có công cụ/i.test(t)) return FIX_FIND;
    if (/không tìm thấy ["“]|trong thư mục được phép|nằm ngoài(?: các)? thư mục|chưa có thư mục được phép|đường dẫn hoặc tên tệp|không phải nội dung tệp|là thư mục, không phải tệp|tham số đường dẫn phải là tên/i.test(t)) return FIX_PATH;
    if (/hết số bước|quá thời gian|ngữ cảnh|vram|bộ nhớ|hết giờ/i.test(t)) return FIX_LONG;
    if (/python|chưa bật|cài đặt/i.test(t)) return FIX_SETUP;
    if (/quá tải số lần|retry\/lỗi|đã thử lại quá nhiều|đã hỏng|không có tác dụng|cách này đã thử/i.test(t)) return FIX_RETRY;
    return FIX_DEFAULT;
  }
  function errorKey(st) {
    const w = actionWhat(st);
    return [st.label || st.name || '', w.verb, w.target, plainError(st)].join('|').toLowerCase();
  }
  function isErrorStep(st) {
    if (!st || st.status === 'running' || st.status === 'asking' || st.status === 'ok' || st.status === 'refused') return false;
    if (st.status === 'error') return true;
    return isGenericRetry(st.summary) || isGenericRetry(st.error);
  }
  function groupSteps(steps) {
    const out = [];
    for (const st of steps || []) {
      if (!isErrorStep(st)) { out.push({ kind: 'step', st }); continue; }
      const key = errorKey(st);
      const prev = out[out.length - 1];
      if (prev && prev.kind === 'err' && prev.key === key) {
        prev.count++; prev.steps.push(st);
        if (typeof st.ms === 'number') prev.ms = (prev.ms || 0) + st.ms;
      } else out.push({ kind: 'err', key, st, steps: [st], count: 1, ms: typeof st.ms === 'number' ? st.ms : null });
    }
    return out;
  }
  function collapseErrorLines(text) {
    const lines = String(text ?? '').split('\n');
    const out = [];
    for (const line of lines) {
      const t = line.trim();
      const prev = out[out.length - 1];
      if (prev && prev.t === t && isErrorLine(t)) prev.n++;
      else out.push({ line, t, n: 1 });
    }
    return out.map(x => (x.n > 1 && isErrorLine(x.t) ? `${stripCount(x.t)} ×${x.n}` : x.line)).join('\n');
  }
  function hasGenericLine(text) {
    return String(text ?? '').split('\n').some(l => isGenericRetry(stripCount(l)));
  }
  function presentBody(text, steps) {
    const collapsed = collapseErrorLines(text);
    const strip = (steps || []).some(isErrorStep) || hasGenericLine(text);
    if (!strip) return collapsed;
    return collapsed.split('\n').filter(line => !isGenericRetry(stripCount(line))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function orphanGroup(text, steps) {
    if ((steps || []).some(isErrorStep)) return null;
    const lines = String(text ?? '').split('\n').map(stripCount).filter(isGenericRetry);
    if (!lines.length) return null;
    return { kind: 'err', key: 'orphan', count: lines.length, ms: null, steps: [], st: { id: 'orphan-retry', status: 'error', label: 'Không rõ bước', name: '', icon: '⚠', summary: lines[0], error: lines[0], args: {} } };
  }
  function errorCardHtml(g, opt) {
    opt = opt || {};
    const st = g.st || {};
    const w = actionWhat(st);
    const err = plainError(st);
    const fix = fixFor([err, st.summary, st.detail, st.check, st.error].filter(Boolean).join('\n'));
    const verb = w.verb ? `<span class="er-verb">${esc(w.verb)}</span>` : '';
    const tgt = w.target ? `<span data-noi18n>“${esc(w.target)}”</span>` : '';
    const rep = g.count > 1 ? `<span class="s-rep">đã lặp ${g.count} lần</span>` : '';
    const ms = (g.ms != null) && opt.fmtMs ? `<span class="s-ms">${opt.fmtMs(g.ms)}</span>` : '';
    const autoTitle = st.auto === 'phrase' ? 'Tự làm không hỏi (theo câu trong yêu cầu của bạn)' : 'Tự làm không hỏi (đang bật)';
    const auto = st.auto ? `<span class="s-auto" title="${esc(autoTitle)}">⚡ tự làm</span>` : '';
    const more = opt.detailHtml ? `<details class="step-more" data-step="${esc(st.id || '')}"${opt.open ? ' open' : ''}><summary>Xem đầu vào và kết quả</summary>${opt.detailHtml}</details>` : '';
    const label = st.label || st.name || 'Không rõ bước';
    return `<div class="step-err" role="alert" data-step="${esc(st.id || '')}"><div class="er-h"><span aria-hidden="true">${esc(st.icon || '⚠')}</span><span class="er-k">Bước lỗi</span><span class="s-name">${esc(label)}</span>${auto}${verb}${tgt}${ms}${rep}<span class="s-st">lỗi</span></div><div class="er-line"><span class="er-k">Lỗi</span> <span class="er-msg">${esc(err)}</span></div><div class="er-line"><span class="er-k">Cách xử lý</span> <span class="er-fix">${esc(fix)}</span></div>${more}</div>`;
  }
  return { esc, isGenericRetry, isErrorLine, isErrorStep, actionWhat, plainError, spokenError, fixFor, groupSteps, collapseErrorLines, presentBody, orphanGroup, errorCardHtml, PLAIN_RETRY, FIX_RETRY, FIX_PATH, FIX_DEFAULT };
});
