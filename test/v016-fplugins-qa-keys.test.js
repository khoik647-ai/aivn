'use strict';
// Ma trận khoá giả QA: mọi lối đọc phải che đủ 24 giá trị. Tệp giả lập nằm ở test/fixtures/qa-keys-410.json.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../src/mcp');
const PG = require('../src/plugins');
const LOG = require('../src/logger');

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'qa-keys-410.json'), 'utf8'));
const K = FIXTURE.K;
const SERVERS = FIXTURE.servers;
const FP = FIXTURE.FP;
const KEYS = Object.keys(K);

function importText() {
  return JSON.stringify({ globalToken: K.toplevel, mcpServers: SERVERS });
}
function needlesOf(key) {
  if (key === 'tele') return [K.tele, K.tele.split(':')[1]];
  return [K[key]];
}
function leaksIn(text, key) {
  const s = String(text);
  return needlesOf(key).some(n => n && s.includes(n));
}
function fakeSecure() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s) => Buffer.from(Buffer.from(String(s), 'utf8').map(b => b ^ 0x5a)),
    decryptString: (b) => Buffer.from(Buffer.from(b).map(x => x ^ 0x5a)).toString('utf8'),
  };
}
function fakeInsecure() {
  return { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text', encryptString: () => { throw new Error('no'); }, decryptString: () => '' };
}
function echoSdk() {
  const seen = [];
  class Client {
    async connect() {
      const last = seen[seen.length - 1];
      throw new Error('echo ' + JSON.stringify(last));
    }
    async listTools() { return { tools: [] }; }
    async close() {}
  }
  class Stdio {
    constructor(opts) {
      seen.push({ kind: 'stdio', command: opts && opts.command, args: opts && opts.args, env: opts && opts.env });
      this.stderr = { on() {} };
    }
  }
  class Http {
    constructor(url, opts) {
      seen.push({ kind: 'http', url: String(url), headers: opts && opts.requestInit && opts.requestInit.headers });
    }
  }
  class Sse {
    constructor(url, opts) {
      seen.push({ kind: 'sse', url: String(url), headers: opts && opts.requestInit && opts.requestInit.headers });
    }
  }
  return { Client, Stdio, Http, Sse, seen };
}
function world({ secure = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qa410-'));
  const logs = [];
  const cards = [];
  const sdk = echoSdk();
  const secrets = PG.createSecretStore({ dir, safeStorage: secure ? fakeSecure() : fakeInsecure() });
  const mcp = M.createMcpManager({
    dir, sdk,
    log: (sc, m) => logs.push(LOG.redact(String(sc) + '\n' + String(m))),
    scrub: (s) => secrets.mask(s),
    resolveSecret: (id) => secrets.get(id),
  });
  const gate = PG.createPluginGate({
    dir, mcp, secrets,
    approve: async (card) => { cards.push(card); return { ok: true, always: true }; },
    log: (sc, m) => logs.push(LOG.redact(String(sc) + '\n' + String(m))),
    agentEnabled: () => true,
  });
  return { dir, logs, cards, sdk, secrets, mcp, gate };
}

test('QA 24 khoá giả: mcp.json, editor, danh sách, thẻ, diff, kế hoạch nhập, lưu, nhật ký đều che', async () => {
  const text = importText();
  const surfaces = [];
  const add = (name, value) => surfaces.push([name, typeof value === 'string' ? value : JSON.stringify(value)]);

  const bare = PG.extractSecrets(JSON.parse(text), null);
  add('extract-null', bare.cfg);
  assert.equal(bare.count, 24);

  const { gate, mcp, secrets, logs, cards, sdk } = world({ secure: true });
  const peeked = gate.peekSecrets(text).count;
  assert.equal(peeked, 24);
  const moved = PG.extractSecrets(JSON.parse(text), secrets);
  add('extract-store', moved.cfg);
  assert.equal(moved.count, 24);
  const jwtHeader = moved.cfg.mcpServers['s-jwt'].headers['X-Session'];
  assert.match(jwtHeader, /^\$\{secret:[^}]+\}$/);
  const stored = secrets.ids().map(id => secrets.get(id));
  assert.equal(stored.filter(v => v === K.jwt).length, 1);
  for (const part of K.jwt.split('.')) assert.equal(stored.includes(part), false, 'jwt bị tách');
  for (const key of KEYS) {
    const needle = key === 'tele' ? K.tele.split(':')[1] : K[key];
    assert.equal(stored.some(v => String(v).includes(needle)), true, 'kho thiếu ' + key);
  }

  const saved = await gate.saveJson(text);
  assert.equal(saved.ok, true);
  assert.equal(saved.secretCount, 24);
  assert.equal(saved.importCard.tool, 'mcp_import');
  assert.deepEqual(saved.replaceCards, []);
  assert.equal(cards.length, 0, 'lưu không được mở thẻ xin phép thứ hai');
  const disk = fs.readFileSync(mcp.file, 'utf8');
  const diskObj = JSON.parse(disk);
  assert.equal(Object.hasOwn(diskObj, 'globalToken'), false);
  add('mcp.json', disk);
  add('mcp-secrets.json', fs.readFileSync(secrets.file, 'utf8'));
  add('editor', gate.publicPayload().text);
  add('ui-list', gate.publicServers());
  add('saveJson', saved);
  add('cardImport', saved.importCard);

  const again = JSON.parse(text);
  again.mcpServers['s-stripe'].args = again.mcpServers['s-stripe'].args.concat(['--verbose']);
  const saved2 = await gate.saveJson(JSON.stringify(again));
  assert.equal(saved2.ok, true);
  assert.equal(saved2.replaceCards.length, 1);
  assert.equal(saved2.replaceCards[0].tool, 'mcp_replace');
  assert.equal(cards.length, 0);
  add('cardReplace', saved2.replaceCards);
  add('saveJson-replace', saved2);
  add('mcp.json-replace', fs.readFileSync(mcp.file, 'utf8'));

  const started = [];
  const probed = [];
  for (const name of Object.keys(SERVERS)) {
    started.push(await gate.startServer(name));
    probed.push(await gate.probeServer(name));
  }
  add('start', started);
  add('probe', probed);
  add('approval', cards.map(PG.cardVisibleText).join('\n'));
  add('status', mcp.status());
  add('ui-list-after', gate.publicServers());
  add('logs', logs.join('\n'));
  for (const item of sdk.seen) add('logger+mask', LOG.redact(secrets.mask(JSON.stringify(item))));

  const rawEcho = sdk.seen.map(s => JSON.stringify(s)).join('\n');
  for (const key of KEYS) {
    if (key === 'nested' || key === 'toplevel') continue;
    const needle = key === 'tele' ? K.tele.split(':')[1] : K[key];
    assert.equal(rawEcho.includes(needle), true, 'máy chủ giả không in ' + key);
  }
  assert.equal(rawEcho.includes(K.nested), false);
  assert.equal(rawEcho.includes(K.toplevel), false);

  const off = world({ secure: false });
  const offSaved = await off.gate.saveJson(text);
  assert.equal(offSaved.ok, true);
  assert.equal(offSaved.secretCount, 24);
  assert.equal(off.secrets.exists(), false);
  add('insecure-mcp.json', fs.readFileSync(off.mcp.file, 'utf8'));
  add('insecure-editor', off.gate.publicPayload().text);
  add('insecure-save', offSaved);
  for (const name of Object.keys(SERVERS)) {
    started.push(await off.gate.startServer(name));
  }
  add('insecure-start', started.slice(-Object.keys(SERVERS).length));
  add('insecure-logs', off.logs.join('\n'));
  add('insecure-status', off.mcp.status());
  add('insecure-approval', off.cards.map(PG.cardVisibleText).join('\n'));
  for (const item of off.sdk.seen) add('insecure-logger+mask', LOG.redact(off.secrets.mask(JSON.stringify(item))));

  const rows = KEYS.map(key => {
    const where = surfaces.filter(([, text]) => leaksIn(text, key)).map(([name]) => name);
    const result = where.length ? 'FAIL' : 'PASS';
    console.log(`| ${key} | ${result}${where.length ? ' ' + where.join(',') : ''} |`);
    return { key, result, where: where.join(',') };
  });
  const passed = rows.filter(r => r.result === 'PASS').length;
  console.log(`| 24/24 | ${passed}/24 |`);
  assert.deepEqual(rows.filter(r => r.result !== 'PASS'), []);
  assert.equal(passed, 24);
});

test('QA không đánh nhầm FP: MAX_TOKENS, KEYBOARD, AUTHOR, --auth none, CLIENT_ID, NODE_ENV, sha, model, docker', () => {
  const fp = FP;
  const store = PG.createSecretStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'aivn-qa410-fp-')), safeStorage: fakeSecure() });
  const moved = PG.extractSecrets({ mcpServers: fp }, store);
  assert.equal(moved.count, 0);
  assert.deepEqual(store.ids(), []);
  assert.equal(JSON.stringify(moved.cfg.mcpServers), JSON.stringify(fp));
  const lone = PG.extractSecrets({ mcpServers: { lone: { command: 'qa-bin', args: [K.awssec] } } }, store);
  assert.equal(lone.count, 0);
  assert.equal(lone.cfg.mcpServers.lone.args[0], K.awssec);
  assert.equal(store.ids().length, 0);

  for (const name of ['MAX_TOKENS', 'KEYBOARD_LAYOUT', 'AUTHOR', 'CLIENT_ID', 'NODE_ENV']) {
    assert.equal(PG.isSecretName(name), false, name);
    console.log(`| ${name} | NOT secret |`);
  }
  assert.equal(PG.secretFindings(fp['fp-auth-none']).length, 0);
  console.log('| --auth none | kept |');
  const sha = fp['fp-ids'].args[1];
  const uuid = fp['fp-ids'].args[3];
  const model = fp['fp-ids'].args[5];
  const image = fp['fp-docker'].args[3];
  const digest = image.split('sha256:')[1];
  assert.equal(PG.likelySecretValue(sha), false);
  assert.equal(PG.likelySecretValue(uuid), false);
  assert.equal(PG.likelySecretValue(model), false);
  assert.equal(PG.likelySecretValue(digest), false);
  const kept = JSON.stringify(moved.cfg);
  for (const needle of ['MAX_TOKENS', '4096', 'KEYBOARD_LAYOUT', 'AUTHOR', 'Khoi', 'CLIENT_ID', 'aivn-desktop', 'NODE_ENV', 'production', sha, uuid, model, image, digest, 'none', fp['fp-auth-none'].args[3]]) {
    assert.equal(kept.includes(needle), true, 'FP bị chuyển nhầm');
  }
  const redacted = LOG.redact(PG.maskKnownSecrets(kept));
  for (const needle of ['MAX_TOKENS', 'KEYBOARD_LAYOUT', 'AUTHOR', 'CLIENT_ID', 'NODE_ENV', sha, model, digest]) {
    assert.equal(redacted.includes(needle), true, 'FP bị che nhầm');
  }
  console.log('| git sha | kept |');
  console.log('| model filename | kept |');
  console.log('| docker sha256 | kept |');
  console.log('| jwt | single ref |');
});
