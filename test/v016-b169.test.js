'use strict';
// B169: Trò chuyện không giữ thanh bước AIVN AGENT, dòng “Đang suy nghĩ…”, hay nút Dừng sau khi câu trả lời đã xong
// (và cũng không hiện chúng khi AIVN AGENT đang chạy ở trang kia).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { planGenChrome } = require('../src/renderer/gen-chrome');
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const think = 'Đang suy nghĩ…';

test('B169: Dừng và dòng trạng thái chỉ ở trang đang tạo câu trả lời; thanh bước chỉ khi AIVN AGENT đang chạy', () => {
  const chatDuringAgent = planGenChrome({ mode: 'chat', genKind: 'agent', genPhase: 'think', genNote: think, agentFoot: '' });
  assert.deepStrictEqual(chatDuringAgent, { sendHidden: false, stopHidden: true, phase: null, genStats: '' });
  const agentLive = planGenChrome({ mode: 'agent', genKind: 'agent', genPhase: 'think', genNote: think, agentFoot: 'cũ' });
  assert.deepStrictEqual(agentLive, { sendHidden: true, stopHidden: false, phase: 'think', genStats: think });
  const chatLive = planGenChrome({ mode: 'chat', genKind: 'chat', genPhase: null, genNote: think, agentFoot: '' });
  assert.deepStrictEqual(chatLive, { sendHidden: true, stopHidden: false, phase: null, genStats: think });
  const agentDuringChat = planGenChrome({ mode: 'agent', genKind: 'chat', genPhase: null, genNote: think, agentFoot: '2 bước dùng công cụ' });
  assert.deepStrictEqual(agentDuringChat, { sendHidden: false, stopHidden: true, phase: null, genStats: '' });
  const idleAgent = planGenChrome({ mode: 'agent', genKind: null, genPhase: 'done', genNote: '', agentFoot: '2 bước dùng công cụ · 41 token' });
  assert.deepStrictEqual(idleAgent, { sendHidden: false, stopHidden: true, phase: null, genStats: '2 bước dùng công cụ · 41 token' });
  const idleChat = planGenChrome({ mode: 'chat', genKind: null, genPhase: null, genNote: '', agentFoot: '2 bước dùng công cụ · 41 token' });
  assert.deepStrictEqual(idleChat, { sendHidden: false, stopHidden: true, phase: null, genStats: '' });
  const askBack = planGenChrome({ mode: 'agent', genKind: 'agent', genPhase: 'ask', genNote: 'Đang suy nghĩ… (bước 2)', agentFoot: '' });
  assert.strictEqual(askBack.phase, 'ask');
  assert.strictEqual(askBack.stopHidden, false);
  assert.strictEqual(askBack.genStats, 'Đang suy nghĩ… (bước 2)');
});

test('B169: thanh bước thuộc AIVN AGENT; trò chuyện không bật Nghĩ; đổi trang vẽ lại khung', () => {
  const html = rd('src/renderer/index.html');
  const strip = html.match(/<div class="([^"]*)" id="phaseStrip"/);
  assert.ok(strip, 'thiếu #phaseStrip');
  assert.match(strip[1], /\bonly-agent\b/);
  assert.match(html, /<script src="gen-chrome\.js"><\/script>\s*<script src="app\.js"><\/script>/);
  const app = rd('src/renderer/app.js');
  assert.doesNotMatch(app, /setPhase\('think'\)/);
  assert.doesNotMatch(app, /textContent === 'Đang suy nghĩ…'/);
  assert.match(app, /I18N\.is\(\$\('#genStats'\)\.textContent, 'Đang suy nghĩ…'\)/);
  const setMode = app.slice(app.indexOf('function setMode(mode)'), app.indexOf('const convoMode'));
  assert.match(setMode, /paintGenChrome\(\);/);
  const runTurn = app.slice(app.indexOf('async function runTurn'), app.indexOf('const fmtSec'));
  assert.doesNotMatch(runTurn, /setPhase\(/);
  assert.match(runTurn, /state\.genKind = 'chat'/);
  assert.match(runTurn, /paintGenChrome\(\);[\s\S]*await A\.saveConvo\(conv\)/);
  const sendAgent = app.slice(app.indexOf('async function sendAgent'), app.indexOf('// --- Hộp thoại xác nhận'));
  assert.match(sendAgent, /state\.genKind = 'agent'/);
  assert.match(sendAgent, /state\.agentFoot = summary/);
  assert.match(sendAgent, /if \(onAgent\) \{ setPhase\('done'\); setTimeout\(\(\) => \{ if \(!state\.generating\) setPhase\(null\); \}, 4000\); \}/);
  assert.match(app, /if \(state\.genKind \|\| !isAgent\(\)\) setPhase\(plan\.phase\);/);
});
