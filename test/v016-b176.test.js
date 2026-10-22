'use strict';
// B176: Enter ở trang KHÔNG đang tạo. Trang rảnh và mô hình dùng chung nhận được thì gửi.
// Trang kia đang giữ mô hình thì nói rõ chỗ bấm Dừng, không bảo “bấm Dừng trước đã” khi trang này không có nút Dừng.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { composerGate } = require('../src/renderer/gen-chrome');
const T = require('../src/i18n/core').create({ en: require('../src/i18n/en'), zh: require('../src/i18n/zh') });
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const WAIT_AGENT = 'AGENT đang chạy — đợi xong hoặc sang AGENT bấm Dừng';
const WAIT_CHAT = 'Trò chuyện đang chạy — đợi xong hoặc sang Trò chuyện bấm Dừng';

test('B176: trang rảnh gửi được; trang kia giữ mô hình thì chờ đúng phía', () => {
  assert.strictEqual(composerGate({ mode: 'chat', generating: null, genKind: null, cloudAgent: false }), 'send');
  assert.strictEqual(composerGate({ mode: 'agent', generating: null, genKind: null, cloudAgent: false }), 'send');
  assert.strictEqual(composerGate({ mode: 'chat', generating: 'r1', genKind: 'chat', cloudAgent: false }), 'busy-here');
  assert.strictEqual(composerGate({ mode: 'agent', generating: 'r1', genKind: 'agent', cloudAgent: false }), 'busy-here');
  assert.strictEqual(composerGate({ mode: 'chat', generating: 'r1', genKind: 'agent', cloudAgent: false }), 'wait-agent');
  assert.strictEqual(composerGate({ mode: 'agent', generating: 'r1', genKind: 'chat', cloudAgent: false }), 'wait-chat');
  // Bộ não đám mây không giữ mô hình trên máy: trang kia chạy vẫn gửi được.
  assert.strictEqual(composerGate({ mode: 'chat', generating: 'r1', genKind: 'agent', cloudAgent: true }), 'send');
  assert.strictEqual(composerGate({ mode: 'agent', generating: 'r1', genKind: 'chat', cloudAgent: true }), 'send');
  assert.strictEqual(composerGate({ mode: 'chat', generating: 'r1', genKind: null, cloudAgent: false }), 'busy-here');
});

test('B176: chữ chờ có vi/en/zh và bản en/zh không còn dấu tiếng Việt', () => {
  assert.strictEqual(T.tr(WAIT_AGENT, 'en'), 'AGENT is running — wait until it finishes, or switch to AGENT and click Stop');
  assert.strictEqual(T.tr(WAIT_CHAT, 'en'), 'Chat is running — wait until it finishes, or switch to Chat and click Stop');
  assert.strictEqual(T.tr(WAIT_AGENT, 'zh'), 'AGENT 正在运行 — 请等它结束，或切到 AGENT 点击停止');
  assert.strictEqual(T.tr(WAIT_CHAT, 'zh'), '对话正在运行 — 请等它结束，或切到对话点击停止');
  for (const lang of ['en', 'zh']) {
    assert.ok(!VI.test(T.tr(WAIT_AGENT, lang)), lang);
    assert.ok(!VI.test(T.tr(WAIT_CHAT, lang)), lang);
  }
});

test('B176: gửi đi qua cổng mô hình dùng chung; không sửa phím duyệt và thẻ xin phép', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/app.js'), 'utf8');
  assert.match(app, /input\.addEventListener\('keydown', e => \{ if \(e\.key === 'Enter' && !e\.shiftKey\) \{ e\.preventDefault\(\); \$\('#composer'\)\.requestSubmit\(\); \} \}\);/);
  const submit = app.slice(app.indexOf("$('#composer').addEventListener('submit'"), app.indexOf('async function runTurn'));
  assert.match(submit, /if \(holdSharedModel\(false\)\) return;/);
  assert.ok(!submit.includes('Đang trả lời — bấm Dừng trước đã'));
  assert.match(app, /toast\('AGENT đang chạy — đợi xong hoặc sang AGENT bấm Dừng'/);
  assert.match(app, /toast\('Trò chuyện đang chạy — đợi xong hoặc sang Trò chuyện bấm Dừng'/);
  assert.match(app, /cloudBrain && state\.settings\.cloudBrain\.on/);
  const acts = app.slice(app.indexOf("$('#messages').addEventListener('click', async (e) => {"), app.indexOf('function editMsg'));
  assert.match(acts, /if \(act !== 'copy' && holdSharedModel\(true\)\) return;/);
  const approveKey = app.slice(app.indexOf("document.addEventListener('keydown', (e) => {"), app.indexOf('A.onAgentApproveCancel'));
  assert.match(approveKey, /if \(!operable\) return/);
  assert.match(approveKey, /e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)/);
  assert.ok(!approveKey.includes('holdSharedModel'));
  assert.ok(!approveKey.includes('wait-agent'));
  assert.match(app, /if \(!approveLive\(\)\) return; \/\/ B177/);
  assert.match(app, /function approveLive\(\)/);
  const card = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/index.html'), 'utf8');
  assert.match(card, /<section class="approve-card only-agent" id="approveCard"/);
  assert.match(card, /<div class="mcp-badges only-agent" id="mcpBadges"/);
});
