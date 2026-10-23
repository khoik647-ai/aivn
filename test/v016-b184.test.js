'use strict';
// B184: việc AGENT trống không hiện Dừng/thanh bước; danh sách có dấu đang chạy;
// dòng “N bước · … giây” không dính việc trước; /moi không bị chặn; gen-chrome.js thẳng lề.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { planGenChrome, composerGate, holdCopy, agentProgress, keepAgentProgress, chromeAfterDelete } = require('../src/renderer/gen-chrome');
const CS = require('../src/renderer/chat-stream');
const T = require('../src/i18n/core').create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const chrome = fs.readFileSync(path.join(root, 'src/renderer/gen-chrome.js'), 'utf8');
const FOOT = '1 bước dùng công cụ · 9,3 giây';
const NOTE = 'Đang suy nghĩ…';
const OTHER = 'Việc đang chạy ở danh sách bên trái — mở việc đó rồi bấm Dừng';

test('B184: việc trống, chưa chạy, không có bước — không Dừng, không thanh bước, không dòng thời gian', () => {
  const empty = planGenChrome({ mode: 'agent', genKind: null, genPhase: null, genNote: '', agentFoot: FOOT, hasSteps: false, showFoot: false });
  assert.strictEqual(empty.stopHidden, true);
  assert.strictEqual(empty.sendHidden, false);
  assert.strictEqual(empty.phase, null);
  assert.strictEqual(empty.genStats, '');
  const fresh = planGenChrome({ mode: 'agent', genKind: null, genPhase: 'done', genNote: '', agentFoot: FOOT, viewingRun: false, hasSteps: false, showFoot: false });
  assert.strictEqual(fresh.stopHidden, true);
  assert.strictEqual(fresh.phase, null);
  assert.strictEqual(fresh.genStats, '');
});

test('B184: đang chạy đúng việc thì hiện Dừng và thanh bước; việc khác thì không', () => {
  const live = planGenChrome({ mode: 'agent', genKind: 'agent', genPhase: 'think', genNote: NOTE, agentFoot: FOOT, viewingRun: true, hasSteps: false, showFoot: false });
  assert.strictEqual(live.stopHidden, false);
  assert.strictEqual(live.sendHidden, true);
  assert.strictEqual(live.phase, 'think');
  assert.strictEqual(live.genStats, NOTE);
  const elsewhere = planGenChrome({ mode: 'agent', genKind: 'agent', genPhase: 'act', genNote: NOTE, agentFoot: FOOT, viewingRun: false, hasSteps: false, showFoot: false });
  assert.strictEqual(elsewhere.stopHidden, true, 'việc trống không hiện Dừng dù lượt khác còn chạy');
  assert.strictEqual(elsewhere.sendHidden, false);
  assert.strictEqual(elsewhere.phase, null);
  assert.strictEqual(elsewhere.genStats, '');
  const withSteps = planGenChrome({ mode: 'agent', genKind: null, genPhase: null, genNote: '', agentFoot: FOOT, hasSteps: true, showFoot: true });
  assert.strictEqual(withSteps.stopHidden, true);
  assert.strictEqual(withSteps.phase, 'done');
  assert.strictEqual(withSteps.genStats, FOOT);
});

test('B184: dòng tóm tắt mất khi việc mới, việc không có bước, hoặc đã xoá', () => {
  const started = planGenChrome({ mode: 'agent', genKind: 'agent', genPhase: null, genNote: 'Đang chuẩn bị (công cụ, ghi nhớ)…', agentFoot: '', viewingRun: true, hasSteps: false, showFoot: false });
  assert.strictEqual(started.genStats, 'Đang chuẩn bị (công cụ, ghi nhớ)…');
  assert.ok(!started.genStats.includes('9,3'));
  const other = planGenChrome({ mode: 'agent', genKind: null, genPhase: null, genNote: '', agentFoot: FOOT, hasSteps: false, showFoot: false });
  assert.strictEqual(other.genStats, '');
  const cleared = planGenChrome({ mode: 'agent', genKind: null, genPhase: 'done', genNote: '', agentFoot: FOOT, hasSteps: false, showFoot: false });
  assert.strictEqual(cleared.genStats, '');
  const chat = planGenChrome({ mode: 'chat', genKind: null, genPhase: null, genNote: '', agentFoot: FOOT, hasSteps: true, showFoot: false });
  assert.strictEqual(chat.phase, null);
  assert.strictEqual(chat.genStats, '');
  assert.strictEqual(chat.stopHidden, true);
});

test('B184: dấu đang chạy trên đúng cuộc, hết khi xong / dừng / lỗi', () => {
  const chat = { id: 'c1', mode: 'chat', title: 'xin chào' };
  const task = { id: 'a1', mode: 'agent', title: 'đọc notepad' };
  const running = { chat, agent: task };
  assert.strictEqual(CS.isRunning(chat, running), true);
  assert.strictEqual(CS.isRunning(task, running), true);
  assert.strictEqual(CS.isRunning({ id: 'a2', mode: 'agent' }, running), false);
  assert.strictEqual(CS.isRunning(null, running), false);
  const badge = CS.runBadge(true);
  assert.match(badge, /class="convo-run"/);
  assert.match(badge, /aria-label="Đang chạy"/);
  assert.match(badge, /title="Đang chạy"/);
  assert.strictEqual(CS.runBadge(false), '');
  assert.strictEqual(T.tr('Đang chạy', 'en'), 'Running');
  assert.strictEqual(T.tr('Đang chạy', 'zh'), '运行中');
  const done = { chat: null, agent: null };
  assert.strictEqual(CS.isRunning(chat, done), false);
  assert.strictEqual(CS.isRunning(task, done), false);
  const stopped = { chat: null, agent: null };
  assert.strictEqual(CS.isRunning(task, stopped), false);
  const errored = { chat: null, agent: null };
  assert.strictEqual(CS.isRunning(chat, errored), false);
});

test('B184: /moi không bị chặn khi đang chạy; cùng lối nút việc mới', () => {
  const moi = app.slice(app.indexOf("{ c: '/moi'"), app.indexOf("{ c: '/preset'"));
  assert.match(moi, /\$\('#newChat'\)\.click\(\)/);
  assert.doesNotMatch(moi, /state\.generating/);
  assert.doesNotMatch(moi, /bấm Dừng trước khi mở cuộc trò chuyện mới/);
  const submit = app.slice(app.indexOf("$('#composer').addEventListener('submit'"), app.indexOf('async function runTurn'));
  const iMoi = submit.search(/\\\/moi/);
  const iHold = submit.search(/holdSharedModel\(\)/);
  assert.ok(iMoi >= 0 && iHold > iMoi, '/moi chạy trước cổng đang bận');
  assert.match(submit, /runSlash\(text\); return;/);
  const slash = app.slice(app.indexOf('function paintSlash'), app.indexOf("input.addEventListener('input', () => { slashSel"));
  assert.match(slash, /x\.c === '\/moi'/);
  assert.doesNotMatch(slash, /if \(isAgent\(\) \|\|/);
});

test('B184: đang xem việc khác thì không bảo bấm Dừng ở dưới', () => {
  assert.strictEqual(composerGate({ mode: 'agent', generating: 'r1', genKind: 'agent', cloudAgent: false, viewingRun: false }), 'busy-other');
  assert.strictEqual(composerGate({ mode: 'chat', generating: 'r1', genKind: 'chat', cloudAgent: false, viewingRun: false }), 'busy-other');
  assert.strictEqual(composerGate({ mode: 'agent', generating: 'r1', genKind: 'agent', cloudAgent: false, viewingRun: true }), 'busy-here');
  assert.strictEqual(composerGate({ mode: 'chat', generating: 'r1', genKind: 'agent', cloudAgent: false }), 'wait-agent');
  assert.strictEqual(holdCopy('busy-other', 'agent'), OTHER);
  assert.strictEqual(holdCopy('busy-other', 'chat'), OTHER);
  assert.strictEqual(T.tr(OTHER, 'en'), 'The running task is in the list on the left — open it, then click Stop');
  assert.strictEqual(T.tr(OTHER, 'zh'), '正在运行的任务在左侧列表 — 请打开它，然后点击停止');
  assert.match(app, /viewingRun: state\.generating && state\.genKind === here \? viewingThisRun\(\)/);
  assert.match(app, /state\.agentFoot = ''; state\.agentFootId = conv\.id/);
  assert.match(app, /state\.agentFoot = summary; state\.agentFootId = conv\.id/);
  assert.match(app, /ChatStream\.isRunning\(c, state\.generatingByMode\)/);
  assert.match(app, /ChatStream\.runBadge\(running\)/);
  assert.match(app, /data-running="1"/);
  const neu = app.slice(app.indexOf("$('#newChat').addEventListener('click'"), app.indexOf('// biểu tượng nút thao tác'));
  assert.match(neu, /paintGenChrome\(\)/);
});

test('B184: gen-chrome.js thẳng lề trong composerGate và holdCopy', () => {
  function body(name, until) {
    const start = chrome.indexOf('function ' + name);
    const end = chrome.indexOf(until, start);
    return chrome.slice(start, end).split('\n').slice(1);
  }
  for (const [name, until] of [['composerGate', '\n  // Câu nhắc'], ['holdCopy', '\n  return {']]) {
    for (const line of body(name, until)) {
      if (!line.trim()) continue;
      assert.ok(/^(?:    |\t)/.test(line) || line === '  }', name + ' lệch lề: ' + JSON.stringify(line));
    }
  }
  assert.doesNotMatch(chrome, /\n(?:if |return |function )/ );
});

test('B199: xoá việc đang xem thì bỏ thanh bước và dòng tóm tắt', () => {
  const task = { id: 'a1', messages: [{ steps: [{ id: 's1' }] }] };
  const next = chromeAfterDelete({ current: task, agentFoot: FOOT, agentFootId: 'a1', deletedId: 'a1' });
  assert.strictEqual(next.current, null);
  assert.strictEqual(next.agentFoot, '');
  assert.strictEqual(next.agentFootId, null);
  const cleared = planGenChrome({ mode: 'agent', genKind: null, genPhase: 'done', genNote: '', agentFoot: next.agentFoot, hasSteps: false, showFoot: !!(next.current && next.agentFootId === (next.current && next.current.id)) });
  assert.strictEqual(cleared.phase, null);
  assert.strictEqual(cleared.genStats, '');
  assert.strictEqual(cleared.stopHidden, true);
  const other = chromeAfterDelete({ current: task, agentFoot: FOOT, agentFootId: 'a1', deletedId: 'a2' });
  assert.strictEqual(other.current, task);
  assert.strictEqual(other.agentFoot, FOOT);
  assert.strictEqual(other.agentFootId, 'a1');
  const kept = planGenChrome({ mode: 'agent', genKind: null, agentFoot: other.agentFoot, hasSteps: true, showFoot: other.agentFootId === other.current.id });
  assert.strictEqual(kept.phase, 'done');
  assert.strictEqual(kept.genStats, FOOT);
  const del = app.slice(app.indexOf("if (e.target.classList.contains('del'))"), app.indexOf('const genRow'));
  assert.match(del, /chromeAfterDelete\(/);
  assert.match(del, /paintGenChrome\(\)/);
  assert.match(del, /state\.agentFoot = next\.agentFoot/);
});

test('B200: tiến độ “ · N giây” chỉ ở đúng việc đang chạy, mất khi /moi hoặc hết lượt', () => {
  const live = agentProgress({ mode: 'agent', viewingRun: true, elapsedMs: 46000, capMs: 240000 });
  assert.strictEqual(live, ' · 46 giây / tối đa 240 giây');
  assert.strictEqual(T.tr(live, 'en'), ' · 46 s / max 240 s');
  assert.strictEqual(T.tr(live, 'zh'), ' · 46 秒 / 最长 240 秒');
  assert.strictEqual(agentProgress({ mode: 'agent', viewingRun: false, elapsedMs: 46000, capMs: 240000 }), '', 'việc trống không nhận tiến độ');
  assert.strictEqual(agentProgress({ mode: 'agent', viewingRun: true, elapsedMs: 4000, capMs: 240000 }), '');
  assert.strictEqual(agentProgress({ mode: 'chat', viewingRun: true, elapsedMs: 46000, capMs: 240000 }), '');
  const plain = agentProgress({ mode: 'agent', viewingRun: true, elapsedMs: 9000 });
  assert.strictEqual(plain, ' · 9 giây');
  assert.strictEqual(T.tr(plain, 'en'), ' · 9 s');
  assert.strictEqual(T.tr(plain, 'zh'), ' · 9 秒');
  assert.strictEqual(keepAgentProgress({ mode: 'agent', genKind: 'agent', viewingRun: true }), true);
  assert.strictEqual(keepAgentProgress({ mode: 'agent', genKind: 'agent', viewingRun: false }), false);
  assert.strictEqual(keepAgentProgress({ mode: 'agent', genKind: null, viewingRun: true }), false, 'hết lượt thì gỡ span');
  assert.strictEqual(keepAgentProgress({ mode: 'chat', genKind: 'agent', viewingRun: false }), false);
  const off = app.slice(app.indexOf('const offSt = A.onAgentStatus'), app.indexOf('let summary'));
  assert.match(off, /agentProgress\(\{/);
  assert.match(off, /viewingThisRun\(\)/);
  assert.doesNotMatch(off, /state\.mode === 'agent'\) \{ const e = \$\('#genStats'\)/);
  const paint = app.slice(app.indexOf('function paintGenChrome'), app.indexOf('function setGenNote'));
  assert.match(paint, /keepAgentProgress\(/);
  assert.match(paint, /querySelector\('\.ag-prog'\)/);
});

// B201: .convo span{flex:1} từng thắng .convo-run nên chấm Đang chạy giãn thành viên hồng.
function cssRules(src, reducedMotion) {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  const parse = () => {
    while (i < css.length) {
      while (i < css.length && /\s/.test(css[i])) i++;
      if (i >= css.length || css[i] === '}') return;
      if (css[i] === '@') {
        const headEnd = css.indexOf('{', i);
        const head = css.slice(i, headEnd);
        i = headEnd + 1;
        if (head.startsWith('@media')) {
          const start = rules.length;
          parse();
          if (css[i] === '}') i++;
          const on = /prefers-reduced-motion\s*:\s*reduce/.test(head);
          if (on !== !!reducedMotion) rules.length = start;
        } else {
          let d = 1;
          while (i < css.length && d) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++; }
        }
        continue;
      }
      const selEnd = css.indexOf('{', i);
      const sel = css.slice(i, selEnd).trim();
      i = selEnd + 1;
      const bodyEnd = css.indexOf('}', i);
      rules.push({ sel, body: css.slice(i, bodyEnd) });
      i = bodyEnd + 1;
    }
  };
  parse();
  return rules;
}
function splitSelectors(sel) {
  const parts = []; let d = 0; let cur = '';
  for (const ch of sel) {
    if (ch === '(') d++;
    else if (ch === ')') d--;
    else if (ch === ',' && d === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function matchCompound(sel, el) {
  let s = sel.trim();
  if (!s || s === '*') return true;
  const tag = /^([a-zA-Z][\w-]*)/.exec(s);
  if (tag) { if (tag[1].toLowerCase() !== el.tag) return false; s = s.slice(tag[1].length); }
  while (s) {
    if (s[0] === '.') {
      const c = /^([a-zA-Z_-][\w-]*)/.exec(s.slice(1));
      if (!c || !el.classes.includes(c[1])) return false;
      s = s.slice(1 + c[1].length);
    } else if (s[0] === '#') {
      const c = /^([a-zA-Z_-][\w-]*)/.exec(s.slice(1));
      if (!c || el.id !== c[1]) return false;
      s = s.slice(1 + c[1].length);
    } else if (s.startsWith(':not(')) {
      const end = s.indexOf(')');
      if (matchCompound(s.slice(5, end), el)) return false;
      s = s.slice(end + 1);
    } else return false;
  }
  return true;
}
function matchSelector(sel, el) {
  const raw = []; const s = sel.trim(); let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if ('>+~'.includes(s[i])) { raw.push(s[i]); i++; continue; }
    let j = i; let d = 0;
    while (j < s.length) {
      if (s[j] === '(') d++;
      else if (s[j] === ')') d--;
      else if (d === 0 && (/\s/.test(s[j]) || '>+~'.includes(s[j]))) break;
      j++;
    }
    raw.push(s.slice(i, j)); i = j;
  }
  const tokens = [];
  for (const cur of raw) {
    const prev = tokens[tokens.length - 1];
    const comb = cur === '>' || cur === '+' || cur === '~';
    const prevComb = prev === '>' || prev === '+' || prev === '~' || prev === ' ';
    if (!comb && prev && !prevComb) tokens.push(' ');
    tokens.push(cur);
  }
  let node = el; let ti = tokens.length - 1;
  if (!tokens[ti] || tokens[ti] === ' ' || tokens[ti] === '>') return false;
  if (!matchCompound(tokens[ti], node)) return false;
  ti--;
  while (ti >= 0) {
    const comb = tokens[ti]; const comp = tokens[ti - 1]; ti -= 2;
    if (comb === '>') { node = node.parent; if (!node || !matchCompound(comp, node)) return false; }
    else if (comb === ' ') {
      node = node.parent; let ok = false;
      while (node) { if (matchCompound(comp, node)) { ok = true; break; } node = node.parent; }
      if (!ok) return false;
    } else return false;
  }
  return true;
}
function specOf(sel) {
  const s = sel.replace(/::[\w-]+(\([^)]*\))?/g, ' ').replace(/:not\(([^)]*)\)/g, ' $1 ');
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+/g) || []).length + (s.match(/\[[^\]]+\]/g) || []).length;
  const t = s.replace(/#[\w-]+/g, ' ').replace(/\.[\w-]+/g, ' ').replace(/\[[^\]]+\]/g, ' ').replace(/:[\w-]+(\([^)]*\))?/g, ' ');
  const c = (t.match(/[a-zA-Z][\w-]*/g) || []).length;
  return [a, b, c];
}
function cmpSpec(x, y) { for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }
function cascaded(src, el, reducedMotion) {
  const out = new Map(); const meta = new Map(); let order = 0;
  for (const rule of cssRules(src, reducedMotion)) {
    for (const sel of splitSelectors(rule.sel)) {
      if (!matchSelector(sel, el)) continue;
      const sp = specOf(sel);
      for (const part of rule.body.split(';')) {
        const p = part.trim(); if (!p) continue;
        const k = p.indexOf(':'); if (k < 0) continue;
        const prop = p.slice(0, k).trim(); const val = p.slice(k + 1).trim();
        const prev = meta.get(prop);
        if (!prev || cmpSpec(sp, prev.sp) > 0 || (cmpSpec(sp, prev.sp) === 0 && order >= prev.order)) {
          out.set(prop, val); meta.set(prop, { sp, order });
        }
      }
    }
    order++;
  }
  return out;
}
test('B201: chấm Đang chạy giữ 8 px, không giãn flex và không cắt tiêu đề', () => {
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  const row = { tag: 'div', classes: ['convo', 'running'], id: '', parent: null };
  const badge = { tag: 'span', classes: ['convo-run'], id: '', parent: row };
  const title = { tag: 'span', classes: [], id: '', parent: row };
  const old = '.convo span{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.convo-run{flex:none;width:8px;height:8px}';
  assert.strictEqual(cascaded(old, badge, false).get('flex'), '1', 'mẫu QA: .convo span thắng .convo-run');
  const dot = cascaded(css, badge, false);
  assert.strictEqual(dot.get('flex'), 'none', 'flex:1 của .convo span không được áp vào chấm');
  assert.strictEqual(dot.get('width'), '8px');
  assert.strictEqual(dot.get('max-width'), '8px');
  assert.strictEqual(dot.get('min-width'), '8px');
  assert.strictEqual(dot.get('height'), '8px');
  assert.strictEqual(dot.get('flex-grow'), undefined);
  const name = cascaded(css, title, false);
  assert.strictEqual(name.get('flex'), '1');
  assert.strictEqual(name.get('text-overflow'), 'ellipsis');
  const still = cascaded(css, badge, true);
  assert.strictEqual(still.get('width'), '8px');
  assert.strictEqual(still.get('flex'), 'none');
  assert.strictEqual(still.get('animation'), 'none');
  assert.match(CS.runBadge(true), /<span class="convo-run"/);
});
