'use strict';
// data-testid ổn định cho phần giao diện vẽ động (thẻ mô hình, dòng mô hình, cuộc trò chuyện, tin nhắn, bước AIVN AGENT, thông báo,
// lịch, Kinh doanh…) — dùng cho QA giao diện (--qa-ui, docs/qa-runner.md). Phần tĩnh đã có data-testid ngay trong index.html.
// Gắn ở MỘT chỗ (không sửa từng mẫu HTML trong app.js/biz.js) để nhánh Kinh doanh song song dễ gộp.
(() => {
  const slug = (s) => String(s == null ? '' : s).trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80).toLowerCase();
  const set = (el, id) => { if (el && id && !el.hasAttribute('data-testid')) el.setAttribute('data-testid', id); };
  const acts = (root, prefix) => { for (const b of root.querySelectorAll('[data-act]')) set(b, `${prefix}-${slug(b.dataset.act)}`); for (const b of root.querySelectorAll('button.del')) set(b, `${prefix}-delete`); };
  const RULES = [
    ['.toast-item', (el) => el.classList.contains('err') ? 'toast-err' : 'toast'],
    ['#convoList .convo[data-id]', (el) => { const p = 'convo-' + slug(el.dataset.id); acts(el, p); return p; }],
    ['#messages .msg[data-i]', (el) => { const p = 'msg-' + el.dataset.i; el.querySelectorAll('details.step').forEach((d, i) => set(d, `${p}-step-${i + 1}`)); acts(el, p); return p; }],
    ['#messages .msg.welcome', () => 'msg-welcome'],
    ['.card[data-id]', (el) => { const p = 'card-' + slug(el.dataset.id); acts(el, p); return p; }],
    ['#modelTable .tr[data-id]', (el) => { const p = 'model-' + slug(el.dataset.id); acts(el, p); return p; }],
    ['.sched-item[data-id]', (el) => { const p = 'sched-' + slug(el.dataset.id); acts(el, p); return p; }],
    ['.mem-item[data-id], #memList [data-id]', (el) => { const p = 'mem-' + slug(el.dataset.id); acts(el, p); return p; }],
    ['.dl-item[data-id], .dl-row[data-id]', (el) => { const p = 'dl-' + slug(el.dataset.id); acts(el, p); return p; }],
    ['#view-crm [data-sub]', (el) => 'biz-sub-' + slug(el.dataset.sub)],
    ['#view-crm tr[data-id], #view-crm [data-id]', (el) => { const p = 'biz-row-' + slug(el.dataset.id); acts(el, p); return p; }],
    ['#view-crm input[name], #view-crm select[name], #view-crm textarea[name]', (el) => 'biz-field-' + slug(el.name)],
    ['#view-crm [data-act]', (el) => 'biz-' + slug(el.dataset.act)],
    ['.modal-back:not([data-testid])', (el) => 'dialog-' + slug(el.id || 'modal')],
    ['[data-act]', (el) => { const r = el.closest('[data-id]'); return 'act-' + slug(el.dataset.act) + (r ? '-' + slug(r.dataset.id) : ''); }],
  ];
  function tag(root = document) { for (const [sel, fn] of RULES) { let list; try { list = root.querySelectorAll(sel); } catch { continue; } for (const el of list) { if (!el.hasAttribute('data-testid')) { try { set(el, fn(el)); } catch {} } } } }
  let queued = false; const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; tag(); }); };
  const start = () => { tag(); new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.__testids = { tag, RULES };
})();
