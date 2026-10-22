'use strict';
// Ma trận 24 khoá giả, dựng lúc chạy. Tiền tố ghép từ mảnh để tệp nguồn không khớp dạng khoá thật.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../src/mcp');
const PG = require('../src/plugins');
const LOG = require('../src/logger');

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const HEX = '0123456789abcdef';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DIGITS = '0123456789';
function chunk(i, n, alphabet = ALPHA) {
  const step = 2 * i + 1;
  let s = '';
  for (let k = 0; k < n; k++) s += alphabet[(i * 7 + k * step) % alphabet.length];
  return s;
}
function withMark(i, n, index, mark) {
  const chars = chunk(i, n).split('');
  chars[index] = mark;
  return chars.join('');
}
function pemHeader() {
  return ['-----', 'BEGIN', ' ', 'RSA', ' ', 'PRIVATE', ' KEY', '-----'].join('');
}
function buildKeys() {
  const sk = ['sk', '-'].join('');
  const ghp = ['gh', 'p_'].join('');
  const pat = ['github', '_pat_'].join('');
  const hf = ['h', 'f_'].join('');
  const akia = ['AK', 'IA'].join('');
  const xoxb = ['xo', 'xb', '-'].join('');
  const stripe = ['sk', '_', 'li', 've_'].join('');
  const awsChars = chunk(6, 39).split('');
  awsChars[14] = '/';
  awsChars[22] = '/';
  return {
    sk: sk + 'proj-' + chunk(1, 32),
    ghp: ghp + chunk(2, 36),
    pat: pat + withMark(3, 53, 22, '_'),
    hf: hf + chunk(4, 32),
    akia: akia + chunk(5, 16, UPPER),
    awssec: awsChars.join(''),
    xoxb: xoxb + chunk(7, 12, DIGITS) + '-' + chunk(8, 13, DIGITS) + '-' + chunk(9, 24),
    jwt: [chunk(10, 36), chunk(11, 44), chunk(12, 43)].join('.'),
    qapikey: chunk(13, 24),
    qtoken: withMark(14, 21, 5, '_'),
    basicpw: chunk(15, 15),
    appid: chunk(16, 32, HEX),
    hex32: chunk(17, 32, HEX),
    splitkey: withMark(18, 16, 8, '_'),
    owmid: chunk(19, 32, HEX),
    tele: chunk(20, 10, DIGITS) + ':' + chunk(21, 34),
    dbpw: withMark(22, 14, 7, '!'),
    argdbpw: chunk(23, 13),
    hdrapikey: chunk(24, 9),
    accesskey: chunk(25, 10),
    dbpass: withMark(26, 13, 11, '&'),
    nested: chunk(27, 16),
    toplevel: sk + 'ant-api03-' + chunk(28, 35),
    stripe: stripe + chunk(29, 31),
  };
}
function buildServers(K) {
  return {
    's-args-sk': { command: 'npx', args: ['-y', 'qa-tool@1.0.0', '--api-key', K.sk] },
    's-args-eq': { command: 'npx', args: ['-y', 'qa-gh@1.0.0', '--token=' + K.ghp] },
    's-env-pat': { command: 'npx', args: ['-y', 'qa-gh2@1.0.0'], env: { GH_PERSONAL: K.pat, HUGGING: K.hf } },
    's-aws': { command: 'uvx', args: ['qa-aws==1.0', '--region', 'us-east-1', K.awssec], env: { AWS_ID: K.akia } },
    's-slack': { command: 'npx', args: ['-y', 'qa-slack@1.0.0'], env: { SLACK_BOT: K.xoxb } },
    's-jwt': { url: 'https://jwt.example.vn/mcp', headers: { 'X-Session': K.jwt } },
    's-q-apikey': { url: 'https://api.example.vn/mcp?api_key=' + K.qapikey + '&lang=vi' },
    's-q-token': { url: 'https://api2.example.vn/mcp?lang=vi&token=' + K.qtoken },
    's-basic': { url: 'https://khoi:' + K.basicpw + '@nas.example.vn/mcp' },
    's-owm': { command: 'npx', args: ['-y', 'qa-weather@1.0.0'], env: { OPENWEATHER_APPID: K.appid, OWM_ID: K.owmid } },
    's-hex': { command: 'qa-bin', args: ['run', K.hex32] },
    's-split': { command: 'qa-bin', args: ['--key', K.splitkey] },
    's-tele': { url: 'https://api.telegram.org/bot' + K.tele + '/mcp' },
    's-dburl': {
      command: 'qa-db',
      args: ['postgresql://u:' + K.argdbpw + '@10.0.0.5/db'],
      env: { DATABASE_URL: 'postgres://admin:' + K.dbpw + '@db.local:5432/app', DB_PASS: K.dbpass },
    },
    's-hdr': { command: 'qa-bin', args: ['-H', 'X-API-Key: ' + K.hdrapikey] },
    's-qaccess': { url: 'https://api3.example.vn/mcp?access_key=' + K.accesskey },
    's-nested': { command: 'qa-bin', args: [], options: { apiKey: K.nested } },
    's-stripe': { command: 'qa-bin', args: ['--stripe', K.stripe] },
  };
}
const FP = {
  'fp-fs': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2025.1.14', '/Users/khoi/Documents/AIVN', 'C:\\Users\\Khoi\\Documents\\AIVN'] },
  'fp-url': { url: 'https://mcp.example.vn/weather?city=hanoi&lang=vi&limit=5' },
  'fp-env': { command: 'qa-bin', args: ['--port', '8080', '--id', '42'], env: { NODE_ENV: 'production', MAX_TOKENS: '4096', KEYBOARD_LAYOUT: 'us', AUTHOR: 'Khoi', LOG_LEVEL: 'debug', CLIENT_ID: 'aivn-desktop' } },
  'fp-ids': { command: 'qa-bin', args: ['--rev', 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3', '--workspace', '123e4567-e89b-12d3-a456-426614174000', '--model', '/opt/aivn/models/Qwen3VL4BInstructQ4KM2025.gguf'] },
  'fp-docker': { command: 'docker', args: ['run', '-i', '--rm', 'ghcr.io/qa/mcp@sha256:3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a'] },
  'fp-auth-none': { command: 'qa-bin', args: ['--auth', 'none', '--token-file', '/home/khoi/.qa-token'] },
};
const K = buildKeys();
const SERVERS = buildServers(K);
const KEYS = Object.keys(K);
for (const a of KEYS) for (const b of KEYS) {
  if (a !== b && K[b].includes(K[a])) throw new Error(a + ' nằm trong ' + b);
}

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
  const pem = pemHeader();
  assert.equal(PG.likelySecretValue(pem), false);
  assert.equal(PG.extractSecrets({ mcpServers: { pem: { command: 'qa-bin', args: [pem] } } }, store).count, 0);
});
