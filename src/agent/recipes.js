'use strict';
// B167 (Khôi: “các thao tác đơn giản và lập lại phải nhanh”): nhớ chuỗi bước của lần chạy THÀNH CÔNG cho đúng câu lệnh đó,
// lần sau đưa cho mô hình làm kế hoạch làm lại theo thứ tự (ít vòng suy nghĩ hơn). Mỗi bước vẫn đi qua screen_act bình thường:
// nhìn màn hình, kiểm tra kết quả, thẻ xin phép, khoá người nhận, kiểm tra cửa sổ đang nhận phím — không có lối tắt nào bỏ qua cổng gửi.
// Lần làm lại thất bại → xoá công thức (không lặp lại cách sai).
const fs = require('fs');
const path = require('path');
const MAX = 200, MAX_STEPS = 14;
const norm = (q) => String(q || '').normalize('NFC').toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[.!?…\s]+$/u, '').trim();
function compact(steps = []) {
  const out = [];
  for (const s of steps) {
    if (!s || s.status !== 'ok' || !s.args) continue;
    if (!['screen_act', 'open_app', 'ensure_app', 'open_chat'].includes(s.name)) continue;
    const a = s.args; const o = { tool: s.name };
    for (const k of ['action', 'element', 'target', 'keys', 'text', 'app', 'name', 'url']) if (a[k] != null && a[k] !== '') o[k] = String(a[k]).slice(0, 200);
    out.push(o);
  }
  return out.slice(0, MAX_STEPS);
}
function describeStep(o, i) {
  const bits = [o.action || o.tool]; if (o.element || o.target) bits.push(`“${o.element || o.target}”`); if (o.keys) bits.push(o.keys); if (o.text) bits.push(`gõ “${o.text}”`); if (o.app || o.name) bits.push(o.app || o.name); if (o.url) bits.push(o.url);
  return `${i + 1}. ${o.tool === 'screen_act' ? '' : o.tool + ': '}${bits.join(' ')}`;
}
function hint(rec) {
  if (!rec || !rec.steps || !rec.steps.length) return '';
  return `\n\nLỆNH NÀY ĐÃ LÀM THÀNH CÔNG TRƯỚC ĐÂY (${rec.ok} lần) với các bước sau. Làm lại ĐÚNG thứ tự này, mỗi bước một lần, không cần dò lại; sau mỗi bước vẫn nhìn màn hình để kiểm tra, nếu màn hình khác lần trước thì tự xử lý như bình thường:\n${rec.steps.map(describeStep).join('\n')}`;
}
function createRecipeStore(file) {
  let data = {};
  try { if (file && fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { data = {}; }
  const save = () => { if (!file) return; try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); } catch {} };
  return {
    get(q) { const r = data[norm(q)]; return r && r.steps && r.steps.length ? r : null; },
    put(q, steps) { const st = compact(steps); if (!st.length) return null; const k = norm(q); const prev = data[k]; data[k] = { steps: st, ok: (prev ? prev.ok : 0) + 1, at: Date.now() }; const ks = Object.keys(data); if (ks.length > MAX) { ks.sort((a, b) => data[a].at - data[b].at); for (const x of ks.slice(0, ks.length - MAX)) delete data[x]; } save(); return data[k]; },
    drop(q) { const k = norm(q); if (data[k]) { delete data[k]; save(); return true; } return false; },
    size: () => Object.keys(data).length,
  };
}
module.exports = { createRecipeStore, compact, hint, norm };
