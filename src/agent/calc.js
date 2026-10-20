// Máy tính an toàn: tự phân tích biểu thức (không dùng eval). Hỗ trợ + - * / % ^ (luỹ thừa), ngoặc,
// hằng số pi, e và các hàm thông dụng. Dấu phẩy thập phân kiểu Việt ("2,5") được hiểu khi không có dấu phẩy ngăn cách tham số.
const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: (x, d = 0) => { const k = 10 ** d; return Math.round(x * k) / k; },
  floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, sign: Math.sign, exp: Math.exp, ln: Math.log, log: (x, b) => b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b),
  log10: Math.log10, log2: Math.log2, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot,
  sum: (...a) => a.reduce((s, x) => s + x, 0), avg: (...a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN, mean: (...a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN,
  fact: (n) => { if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error('giai thừa chỉ nhận số nguyên 0–170'); let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; },
};
const CONSTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const s = String(src).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^');
  if (s.length > 2000) throw new Error('biểu thức quá dài');
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = s.slice(i).match(/^(\d+(?:\.\d+)?|\.\d+)(e[+-]?\d+)?/i);
    if (num) { out.push({ t: 'n', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = s.slice(i).match(/^[a-z_][a-z0-9_]*/i);
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    if ('+-*/%^(),!'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error(`ký tự không hợp lệ "${c}"`);
  }
  return out;
}

function evaluate(expr) {
  // "2,5 + 1" (dấu phẩy thập phân) → "2.5 + 1" nếu không có hàm nào dùng dấu phẩy ngăn tham số
  let src = String(expr);
  if (!/[a-z]\s*\(/i.test(src)) src = src.replace(/(\d),(\d)/g, '$1.$2');
  const tk = tokenize(src); let p = 0;
  const peek = () => tk[p], next = () => tk[p++];
  const expect = (t) => { const x = next(); if (!x || x.t !== t) throw new Error(`thiếu "${t}"`); };
  function primary() {
    const x = next();
    if (!x) throw new Error('biểu thức chưa đầy đủ');
    if (x.t === 'n') return x.v;
    if (x.t === '(') { const v = add(); expect(')'); return v; }
    if (x.t === '-') return -power();
    if (x.t === '+') return power();
    if (x.t === 'id') {
      if (peek() && peek().t === '(') {
        const f = FUNCS[x.v]; if (!f) throw new Error(`không biết hàm "${x.v}"`);
        next(); const args = [];
        if (peek() && peek().t !== ')') { args.push(add()); while (peek() && peek().t === ',') { next(); args.push(add()); } }
        expect(')'); return f(...args);
      }
      if (x.v in CONSTS) return CONSTS[x.v];
      throw new Error(`không biết "${x.v}"`);
    }
    throw new Error(`không mong đợi "${x.t}"`);
  }
  function postfix() { let v = primary(); while (peek() && peek().t === '!') { next(); v = FUNCS.fact(v); } while (peek() && peek().t === '%' && (!tk[p + 1] || [')', '+', '-', ',', '*', '/', '^'].includes(tk[p + 1].t))) { next(); v = v / 100; } return v; }
  function power() { const b = postfix(); if (peek() && peek().t === '^') { next(); return b ** unary(); } return b; }
  function unary() { if (peek() && peek().t === '-') { next(); return -unary(); } if (peek() && peek().t === '+') { next(); return unary(); } return power(); }
  function mul() { let v = unary(); while (peek() && ['*', '/', '%'].includes(peek().t)) { const o = next().t; const r = unary(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; }
  function add() { let v = mul(); while (peek() && ['+', '-'].includes(peek().t)) { const o = next().t; const r = mul(); v = o === '+' ? v + r : v - r; } return v; }
  const v = add();
  if (p < tk.length) throw new Error(`thừa "${tk[p].t === 'n' ? tk[p].v : tk[p].v || tk[p].t}"`);
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error('kết quả không phải là số');
  return v;
}
const fmtVi = (v) => Number.isFinite(v) ? (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0) ? v.toExponential(6) : (+v.toPrecision(12)).toLocaleString('vi-VN', { maximumFractionDigits: 10 })) : String(v);
module.exports = { evaluate, fmtVi };
