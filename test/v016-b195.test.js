'use strict';
// B195 (#62): nút đổi thư mục mô hình nhận Enter/Space, có tên trợ năng, và hộp thoại gắn cửa sổ cha.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { bindPickerButton } = require('../src/renderer/picker-button');
const { focusDialogParent } = require('../src/dialog-parent');
const { accessibilityPlan, armAccessibility } = require('../src/a11y-support');
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function el(tag, attrs = {}) {
  const listeners = {};
  const node = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    dataset: {},
    disabled: false,
    tabIndex: tag.toUpperCase() === 'BUTTON' ? 0 : -1,
    classList: { add(c) { node.classes.push(c); } },
    classes: [],
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(node.attrs, n) ? node.attrs[n] : null; },
    setAttribute(n, v) { node.attrs[n] = String(v); },
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    click() { for (const fn of listeners.click || []) fn({ type: 'click', target: node, preventDefault() {} }); },
    focus() { node.focused = true; },
    dispatch(type, key, extra = {}) {
      const e = { type, key, code: key === ' ' ? 'Space' : key, repeat: false, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, target: node, ...extra };
      for (const fn of listeners[type] || []) fn(e);
      return e;
    },
  };
  return node;
}

test('Enter và Space trên nút gọi đúng một lần IPC chọn thư mục; nút focus được và có tên', () => {
  const button = el('button', { type: 'button', 'aria-label': 'Đổi thư mục lưu mô hình' });
  const ipc = [];
  button.addEventListener('click', () => ipc.push('models:dir-pick'));
  bindPickerButton(button);
  assert.strictEqual(button.getAttribute('type'), 'button');
  assert.ok(button.tabIndex >= 0, 'focus được');
  assert.strictEqual(button.getAttribute('aria-label'), 'Đổi thư mục lưu mô hình');
  button.focus(); assert.strictEqual(button.focused, true);
  const enter = button.dispatch('keydown', 'Enter');
  assert.strictEqual(enter.defaultPrevented, true);
  assert.deepStrictEqual(ipc, ['models:dir-pick']);
  button.dispatch('keyup', 'Enter');
  assert.deepStrictEqual(ipc, ['models:dir-pick'], 'Enter không gọi lần hai');
  const down = button.dispatch('keydown', ' ');
  assert.strictEqual(down.defaultPrevented, true);
  assert.deepStrictEqual(ipc, ['models:dir-pick'], 'Space chưa gọi khi nhấn xuống');
  button.dispatch('keyup', ' ');
  assert.deepStrictEqual(ipc, ['models:dir-pick', 'models:dir-pick']);
  button.disabled = true;
  button.dispatch('keydown', 'Enter');
  button.dispatch('keydown', ' '); button.dispatch('keyup', ' ');
  assert.strictEqual(ipc.length, 2, 'nút tắt không mở hộp thoại');
  bindPickerButton(button);
  button.disabled = false;
  button.dispatch('keydown', 'Enter');
  assert.strictEqual(ipc.length, 3, 'gắn lần hai không nhân đôi');
});

test('nút trong Cài đặt là button có tên trợ năng; nút chọn tệp khoá cùng kiểu', () => {
  const html = rd('src/renderer/index.html');
  const m = html.match(/<button[^>]*id="mdirChange"[^>]*>/);
  assert.ok(m, 'thiếu #mdirChange');
  assert.match(m[0], /type="button"/);
  assert.match(m[0], /data-testid="mdir-change"/);
  assert.match(m[0], /aria-label="Đổi thư mục lưu mô hình"/);
  assert.match(m[0], /picker-hit/);
  assert.match(html, /<script src="picker-button\.js"><\/script>\s*<script src="app\.js"><\/script>/);
  assert.doesNotMatch(html, /input-diag\.js/);
  const app = rd('src/renderer/app.js');
  assert.match(app, /id="admImport" aria-label="Chọn tệp khoá và nhập"/);
  assert.match(app, /<button type="button" class="btn primary" id="admImport"/);
  assert.match(app, /armPicker\(\$\('#mdirChange'\), 'Đổi thư mục lưu mô hình'\)/);
  assert.match(app, /armPicker\(\$\('#addFolder'\)\)/);
  assert.match(app, /armPicker\(\$\('#importBtn'\)\)/);
  const bare = el('button');
  bindPickerButton(bare);
  assert.strictEqual(bare.getAttribute('type'), 'button');
  assert.ok(bare.tabIndex >= 0);
});

test('không có Enter trần toàn cục gọi preventDefault', () => {
  const app = rd('src/renderer/app.js');
  assert.match(app, /if \(e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)\) \{ e\.preventDefault\(\); apAnswer\(true\); \}/);
  const starts = []; const re = /document\.addEventListener\('keydown'/g; let m;
  while ((m = re.exec(app))) starts.push(m.index);
  assert.ok(starts.length >= 3, 'có ' + starts.length + ' listener keydown trên document');
  for (const i of starts) {
    const slice = app.slice(i, i + 600);
    const enter = slice.indexOf("e.key === 'Enter'");
    if (enter < 0) continue;
    const cond = slice.slice(enter, enter + 90);
    assert.match(cond, /ctrlKey/, 'Enter trên document phải kèm Ctrl/Cmd: ' + cond);
  }
  const diag = rd('src/renderer/input-diag.js');
  assert.match(diag, /ctrlKey \|\| e\.metaKey \|\| e\.altKey/);
  assert.doesNotMatch(diag, /e\.key === 'Enter'/);
  assert.doesNotMatch(rd('src/renderer/index.html'), /input-diag/);
});

test('hộp thoại nhận cửa sổ cha và focus cửa sổ nếu chưa được chọn', () => {
  const opts = { title: 'Chọn thư mục lưu mô hình', properties: ['openDirectory'] };
  const seen = [];
  const dialog = { showOpenDialog(a, b) { seen.push([a, b]); return Promise.resolve({ canceled: true, filePaths: [] }); } };
  const win = { isDestroyed: () => false, isFocused: () => false, focus() { this.focused = true; } };
  const wrapped = ((d) => { const f = d.showOpenDialog.bind(d); d.showOpenDialog = (a, b) => (b === undefined ? f(a) : f(focusDialogParent(a), b)); return d; })(dialog);
  wrapped.showOpenDialog(win, opts);
  assert.strictEqual(win.focused, true);
  assert.strictEqual(seen[0][0], win, 'đối số cửa sổ cha');
  assert.strictEqual(seen[0][1], opts);
  const win2 = { isDestroyed: () => false, isFocused: () => true, focus() { throw new Error('đã được chọn thì không focus lại'); } };
  wrapped.showOpenDialog(win2, opts);
  assert.strictEqual(seen[1][0], win2);
  const dead = { isDestroyed: () => true, focus() { throw new Error('cửa sổ đã huỷ'); } };
  assert.strictEqual(focusDialogParent(dead), dead);
  const main = rd('src/main.js');
  assert.match(main, /dialog\[k\] = \(a, b\) => \(b === undefined \? f\(TO\(a\)\) : f\(a, TO\(b\)\)\)/);
  assert.match(main, /dialog\[k\] = \(a, b\) => \(b === undefined \? wrapped\(a\) : wrapped\(focusDialogParent\(a\), b\)\)/);
  assert.match(main, /ipcMain\.handle\('models:dir-pick'[\s\S]{0,500}dialog\.showOpenDialog\(win, \{ title: 'Chọn thư mục lưu mô hình'/);
  assert.match(main, /dialog\.showOpenDialog\(win, \{ buttonLabel: 'Mở', title: 'Chọn tệp khoá quản trị/);
  const ready = main.indexOf('armAccessibility(app)');
  const show = main.indexOf('createWindow({ hidden:');
  assert.ok(ready > 0 && ready < show, 'bật trợ năng trước khi tạo cửa sổ, không chặn show');
  assert.match(main, /show: false/);
  assert.match(main, /ready-to-show/);
});

test('cây trợ năng chỉ bật khi hệ điều hành đã báo; không chặn lần vẽ', () => {
  const off = { calls: [], isAccessibilitySupportEnabled: () => false, getAccessibilitySupportFeatures: () => [], setAccessibilitySupportEnabled(v) { this.calls.push(v); }, on() {} };
  assert.deepStrictEqual(accessibilityPlan(off, 'win32').enable, false);
  assert.strictEqual(accessibilityPlan(off, 'win32').reason, 'lazy-until-client');
  const armed = armAccessibility(off, 'win32');
  assert.strictEqual(armed.enable, false);
  assert.deepStrictEqual(off.calls, []);
  assert.strictEqual(armed.listening, true);
  const on = { calls: [], isAccessibilitySupportEnabled: () => true, getAccessibilitySupportFeatures: () => ['screenReader'], setAccessibilitySupportEnabled(v) { this.calls.push(v); }, on(ev, fn) { this.fn = fn; } };
  const plan = armAccessibility(on, 'win32');
  assert.strictEqual(plan.enable, true);
  assert.strictEqual(plan.reason, 'os-reported');
  assert.deepStrictEqual(on.calls, [true]);
  on.calls.length = 0;
  on.fn({}, true);
  assert.deepStrictEqual(on.calls, [true]);
  assert.strictEqual(accessibilityPlan({ isAccessibilitySupportEnabled: () => false }, 'linux').reason, 'platform');
  const linux = { calls: [], setAccessibilitySupportEnabled(v) { this.calls.push(v); }, on() { throw new Error('không lắng nghe trên linux'); } };
  assert.deepStrictEqual(armAccessibility(linux, 'linux').enable, false);
  assert.deepStrictEqual(linux.calls, []);
});
