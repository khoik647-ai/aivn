// AIVN i18n — dịch giao diện trực tiếp (đổi ngôn ngữ không cần khởi động lại).
// Giữ bản tiếng Việt gốc của từng nút chữ/thuộc tính; MutationObserver dịch mọi thứ app.js vẽ thêm (thông báo, hộp thoại, danh sách…).
// KHÔNG dịch nội dung người dùng/mô hình: tin nhắn chat, ô nhập, mã, phần [data-noi18n].
(function () {
  'use strict';
  const CORE = window.AIVN_I18N_CORE; const D = window.AIVN_I18N || {};
  const T = CORE.create(D);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt', 'label', 'data-empty'];
  const SKIP = '[data-noi18n], .msg:not(.welcome) .body, .msg .think-body, pre, code, textarea, script, style, title, [contenteditable="true"]'; // <title> do doTitle lo
  let lang = 'vi';
  try { lang = localStorage.getItem('aivn-lang') || 'vi'; } catch {}
  if (!CORE.LANGS.includes(lang)) lang = 'vi';
  const texts = new WeakMap(); const attrs = new WeakMap();
  const skip = (el) => !el || (el.closest && el.closest(SKIP));
  const SKIP_ATTR = '[data-noi18n], .msg:not(.welcome) .body, .msg .think-body, pre, code, script, style'; // ô nhập: vẫn dịch placeholder/title, không đụng nội dung
  const skipAttr = (el) => !el || (el.closest && el.closest(SKIP_ATTR));
  function doText(n) {
    const v = n.nodeValue; if (!v || !v.trim()) return;
    let o = texts.get(n);
    if (!o || (v !== o.vi && v !== o.tr)) o = { vi: v }; // app.js vừa ghi chữ mới (tiếng Việt)
    if (skip(n.parentElement)) { texts.set(n, o); return; }
    o.tr = lang === 'vi' ? o.vi : T.tr(o.vi, lang); texts.set(n, o);
    if (v !== o.tr) n.nodeValue = o.tr;
  }
  function doAttr(el, a) {
    const v = el.getAttribute(a); if (v == null || !v.trim()) return;
    let m = attrs.get(el); if (!m) { m = {}; attrs.set(el, m); }
    let o = m[a]; if (!o || (v !== o.vi && v !== o.tr)) o = m[a] = { vi: v };
    o.tr = lang === 'vi' ? o.vi : T.tr(o.vi, lang);
    if (v !== o.tr) el.setAttribute(a, o.tr);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (root.matches && root.matches('pre, code, script, style, [data-noi18n]')) return; for (const a of ATTRS) if (root.hasAttribute(a) && !skipAttr(root)) doAttr(root, a); if (root.matches('textarea, [contenteditable="true"]')) return; }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.nodeType === 1 && n.matches('pre, code, script, style, [data-noi18n], .msg:not(.welcome) .body') ? NodeFilter.FILTER_REJECT : (n.nodeType === 3 && n.parentElement && n.parentElement.matches('textarea, [contenteditable="true"], title')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let n; while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a); }
  }
  let titleVi = null, titleShown = null; // tiêu đề gốc (vi) và bản đang hiện; app.js đặt tiêu đề mới → coi là gốc
  function doTitle() { const t = document.title; if (titleVi == null || (t !== titleVi && t !== titleShown)) titleVi = t; const want = lang === 'vi' ? titleVi : T.tr(titleVi, lang); titleShown = want; if (document.title !== want) document.title = want; }
  const mo = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') { if (!skipAttr(r.target)) doAttr(r.target, r.attributeName); }
      else for (const n of r.addedNodes) { if (n.nodeType === 3) doText(n); else if (n.nodeType === 1 && !skip(n.parentElement)) walk(n); }
    }
  });
  function start() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    walk(document.body); doTitle();
    mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    const te = document.querySelector('title'); if (te) new MutationObserver(doTitle).observe(te, { childList: true, characterData: true, subtree: true });
  }
  function setLang(l) {
    if (!CORE.LANGS.includes(l)) l = 'vi'; if (l === lang) return lang; lang = l;
    try { localStorage.setItem('aivn-lang', l); } catch {}
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : l;
    walk(document.body); doTitle(); window.dispatchEvent(new CustomEvent('aivn-lang', { detail: l }));
    return lang;
  }
  // dịch chuỗi trong mã (vd. hộp thoại confirm/alert gốc, giá trị so sánh): t('Lưu') → 'Save'
  const t = (s) => (lang === 'vi' ? s : T.tr(s, lang));
  // nhận ra chữ hiển thị đúng với câu gốc tiếng Việt bất kể ngôn ngữ đang dùng
  const is = (shown, vi) => shown === vi || shown === T.tr(vi, lang);
  window.I18N = { setLang, t, is, get lang() { return lang; }, names: CORE.LANG_NAMES, LANGS: CORE.LANGS, tr: T.tr, walk };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
