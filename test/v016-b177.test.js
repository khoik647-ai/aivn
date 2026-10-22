'use strict';
// B177: thẻ “AIVN AGENT xin phép chạy lệnh” không được hiện hay bấm được ở Trò chuyện.
// Ctrl+Enter / Esc ở Trò chuyện không duyệt. Gợi ý trên Trò chuyện chỉ chuyển sang AIVN AGENT.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const AG = require('../src/renderer/approve-gate');
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function resolves(state, key, mods) {
  if (!AG.approveOperable(state)) return null;
  if (key === 'Enter' && (mods.ctrl || mods.meta)) return 'allow';
  if (key === 'Escape') return 'deny';
  return null;
}
const chat = { viewActive: true, agentMode: false, cardHidden: false, focused: true };
const agentCard = { viewActive: true, agentMode: true, cardHidden: false, focused: false };
const agentHidden = { viewActive: true, agentMode: true, cardHidden: true, focused: false };
const agentFocused = { viewActive: true, agentMode: true, cardHidden: true, focused: true };
const settings = { viewActive: false, agentMode: true, cardHidden: false, focused: true };

test('B177: thẻ xin phép chỉ hiện trên AIVN AGENT; Trò chuyện chỉ có gợi ý không duyệt', () => {
  assert.strictEqual(AG.cardVisible(true, false), true);
  assert.strictEqual(AG.cardVisible(false, false), false, 'thuộc tính hidden=false vẫn không hiện thẻ ở Trò chuyện');
  assert.strictEqual(AG.cardVisible(true, true), false);
  assert.strictEqual(AG.hintVisible(false, true), true);
  assert.strictEqual(AG.hintVisible(true, true), false, 'trang AGENT không hiện gợi ý');
  assert.strictEqual(AG.hintVisible(false, false), false);
  assert.strictEqual(resolves(chat, 'Enter', { ctrl: true }), null);
  assert.strictEqual(resolves(chat, 'Enter', { meta: true }), null);
  assert.strictEqual(resolves(chat, 'Escape', {}), null);
  assert.strictEqual(resolves(settings, 'Enter', { ctrl: true }), null);
  assert.strictEqual(resolves(settings, 'Escape', {}), null);
  assert.strictEqual(resolves(agentCard, 'Enter', { ctrl: true }), 'allow');
  assert.strictEqual(resolves(agentCard, 'Escape', {}), 'deny');
  assert.strictEqual(resolves(agentHidden, 'Escape', {}), null);
  assert.strictEqual(resolves(agentFocused, 'Enter', { ctrl: true }), 'allow');
});

test('B177: lớp only-agent trên thẻ và huy hiệu MCP; gợi ý only-chat không gọi duyệt', () => {
  const html = rd('src/renderer/index.html');
  const css = rd('src/renderer/styles.css');
  const card = html.match(/<section class="([^"]*)" id="approveCard"/);
  assert.ok(card, '#approveCard');
  assert.match(card[1], /\bapprove-card\b/);
  assert.match(card[1], /\bonly-agent\b/);
  const badges = html.match(/<div class="([^"]*)" id="mcpBadges"/);
  assert.ok(badges, '#mcpBadges');
  assert.match(badges[1], /\bonly-agent\b/);
  for (const id of ['agentBar', 'agentWarn', 'phaseStrip', 'agentSettings']) {
    const el = html.match(new RegExp('<[a-z]+ class="([^"]*)" id="' + id + '"'));
    assert.ok(el, id);
    assert.match(el[1], /\bonly-agent\b/, id);
  }
  const hint = html.match(/<button type="button" class="([^"]*)" id="agentWait"[^>]*>AGENT đang chờ bạn cho phép<\/button>/);
  assert.ok(hint, 'gợi ý');
  assert.match(hint[1], /\bonly-chat\b/);
  assert.doesNotMatch(hint[1], /\bonly-agent\b/);
  assert.match(css, /\.only-agent\{display:none!important\}/);
  assert.match(css, /#view-chat\.agent-mode \.only-agent\{display:flex!important\}/);
  assert.match(css, /#view-chat\.agent-mode \.only-agent\[hidden\]\{display:none!important\}/);
  assert.match(css, /#view-chat\.agent-mode \.only-chat\{display:none!important\}/);
  assert.match(css, /#view-chat\.agent-mode \.only-agent\.approve-card\{flex-direction:column/);
  const app = rd('src/renderer/app.js');
  const keyAt = app.indexOf("document.addEventListener('keydown', (e) => {");
  const waitAt = app.indexOf("$('#agentWait').addEventListener");
  const keys = app.slice(keyAt, waitAt);
  const guard = keys.indexOf('if (!operable) return');
  const ask = keys.indexOf('approveLive()');
  assert.ok(guard >= 0 && ask >= 0 && ask < guard, 'phím tắt hỏi approveLive trước khi duyệt');
  assert.ok(guard < keys.indexOf('apAnswer(true)'));
  assert.ok(guard < keys.indexOf("apAnswer(false"));
  const live = app.slice(app.indexOf('function approveLive()'), app.indexOf('function paintAgentWait'));
  assert.match(live, /ApproveGate\.approveOperable/);
  const wait = app.slice(waitAt, waitAt + 80);
  assert.match(wait, /show\('agent'\)/);
  assert.doesNotMatch(wait, /apAnswer/);
  assert.match(app, /if \(!approveLive\(\)\) return; \/\/ B177/);
  assert.ok(html.indexOf('<script src="approve-gate.js"></script>') < html.indexOf('<script src="app.js"></script>'));
});
