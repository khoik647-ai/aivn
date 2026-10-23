'use strict';
// Cổng vòng 6 của PR #12. Ca mới, thêm vào; không sửa ca cổng cũ.
// Mọi khoá giả được ghép lúc chạy. Không có chuỗi trông như khoá thật trong tệp.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../src/plugins');
const LOG = require('../src/logger');

const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function mixKey() {
  let s = '';
  for (let i = 0; i < 32; i++) s += AL[(i * 7 + 3) % AL.length];
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/\d/.test(s)) throw new Error('mix');
  return s;
}
function hexChars(n) {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < n; i++) s += h[i % 16];
  return s;
}
function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }
const KEY = mixKey();
const H40 = hexChars(40);
const H32 = hexChars(32);
const GHP = 'gh' + 'p_' + KEY.slice(0, 16);
const SK = 's' + 'k-' + KEY.slice(0, 12);

const fakeSafe = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (s) => Buffer.from('ENC' + Buffer.from(s).toString('hex')),
  decryptString: (b) => Buffer.from(String(b).slice(3), 'hex').toString(),
};

function gone(text, secrets) {
  const s = String(text);
  for (const v of secrets) if (v && s.includes(v)) return false;
  return true;
}

test('[r6 A] LOG.redact gán nháy đơn, khoảng trắng, TOML', () => {
  const lines = [
    "export API_TOKEN='" + KEY + "'",
    "API_KEY='" + KEY + "'",
    'API_KEY = ' + KEY,
    'api_key = "' + KEY + '"',
  ];
  for (const line of lines) {
    const r = LOG.redact(line);
    assert.ok(!r.includes(KEY), 'LEAK ' + line.slice(0, 24));
    assert.ok(r.includes('••••'));
  }
});

test('[r6 A] LOG.redact JSON lồng và repr Python', () => {
  const lines = [
    '{"body":"{\\"apiKey\\":\\"' + KEY + '\\"}"}',
    "{'api_key': '" + KEY + "'}",
    "{'Authorization': 'Token " + KEY + "'}",
  ];
  for (const line of lines) {
    const r = LOG.redact(line);
    assert.ok(!r.includes(KEY), 'LEAK');
    assert.ok(r.includes('••••'));
  }
});

test('[r6 A] LOG.redact YAML tên có gạch dưới, không nuốt dòng sau, block scalar', () => {
  const cases = [
    ['api_key: ' + KEY, 'api_key:'],
    ['client_secret: ' + KEY, 'client_secret:'],
    ['name: x\nsecret: ' + KEY, 'name: x\n'],
    ['name: x\npassword: ' + KEY, 'name: x\n'],
    ['secret: |\n  ' + KEY, 'secret:'],
    ['client_secret: >\n  ' + KEY, 'client_secret:'],
    ['password: |-\n  ' + KEY, 'password:'],
  ];
  for (const [line, keep] of cases) {
    const r = LOG.redact(line);
    assert.ok(!r.includes(KEY), 'LEAK ' + JSON.stringify(line).slice(0, 40));
    assert.ok(r.includes(keep), 'mất nhãn ' + keep);
    assert.ok(r.includes('••••'));
  }
});

test('[r6 A] LOG.redact base64 của hex, user:hex và URL postgres; câu chữ có khoảng trắng được giữ', () => {
  const blobs = [
    b64(H40),
    b64('user:' + H40),
    b64(H32),
    b64('postgres://u:' + KEY + '@h/db'),
    b64('postgresql://u:' + 'pw' + H32.slice(0, 16) + '@h/db'),
  ];
  for (const enc of blobs) {
    const r = LOG.redact('blob ' + enc + ' tail');
    assert.ok(!r.includes(enc), 'LEAK base64');
    assert.ok(!r.includes(KEY));
    assert.ok(r.includes('blob ') && r.includes(' tail'));
    assert.ok(r.includes('••••'));
  }
  const prose = b64('hello world this is plain config text for the folder');
  const kept = LOG.redact('hint ' + prose + ' end');
  assert.ok(kept.includes(prose), 'câu chữ base64 bị che');
  assert.ok(kept.includes('hint ') && kept.includes(' end'));
});

function surfaces(label, def, secrets) {
  test('[r6] ' + label, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p12r6-'));
    try {
      const store = P.createSecretStore({ dir, safeStorage: fakeSafe });
      const cfg = { mcpServers: { s1: JSON.parse(JSON.stringify(def)) } };
      const ex = P.extractSecrets(cfg, store);
      const saved = JSON.stringify(ex.cfg);
      const findings = JSON.stringify(P.secretFindings(JSON.parse(JSON.stringify(def))));
      const redObj = JSON.stringify(LOG.redact(def));
      const redTxt = LOG.redact(JSON.stringify(def));
      const deep = JSON.stringify(store.maskDeep(def));
      const cmdline = def.url ? def.url : [def.command || '', ...(def.args || [])].join(' ');
      const redLine = LOG.redact(cmdline);
      const errLine = LOG.redact('Error: ' + cmdline);
      for (const v of secrets) {
        assert.ok(!saved.includes(v), 'mcp.json');
        assert.ok(findings.includes(v), 'secretFindings không thấy');
        assert.ok(!redObj.includes(v), 'LOG.redact object');
        assert.ok(!redTxt.includes(v), 'LOG.redact JSON text');
        assert.ok(!deep.includes(v), 'maskDeep');
        assert.ok(!redLine.includes(v), 'LOG.redact dòng lệnh');
        assert.ok(!errLine.includes(v), 'LOG.redact dòng lỗi');
      }
      assert.ok(ex.count >= secrets.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

// P411-1: đối số docker/env, ADO, mysql, --api key, chuỗi lệnh.
surfaces('P411-1 docker -e GITHUB_PERSONAL_ACCESS_TOKEN', {
  command: 'docker',
  args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN=' + GHP, 'ghcr.io/github/github-mcp-server'],
}, [GHP]);
surfaces('P411-1 docker run -e GITHUB_TOKEN', {
  command: 'docker', args: ['run', '-e', 'GITHUB_TOKEN=' + KEY],
}, [KEY]);
surfaces('P411-1 --env NAME=value', {
  command: 'docker', args: ['run', '--env', 'QA_TOKEN=zqenv1'],
}, ['zqenv1']);
surfaces('P411-1 --env=QA_TOKEN', {
  command: 'docker', args: ['run', '--env=QA_TOKEN=zqenv2'],
}, ['zqenv2']);
surfaces('P411-1 đối số lẻ OPENAI_API_KEY', {
  command: 'qa-bin', args: ['OPENAI_API_KEY=' + SK],
}, [SK]);
surfaces('P411-1 đối số lẻ tên ngắn PAT', {
  command: 'qa-bin', args: ['PAT=zqpat'],
}, ['zqpat']);
surfaces('P411-1 ADO Password=', {
  command: 'qa-bin', args: ['Server=x;Password=' + KEY + ';'],
}, [KEY]);
surfaces('P411-1 ADO Pwd=', {
  command: 'qa-bin', args: ['Pwd=' + KEY],
}, [KEY]);
surfaces('P411-1 mysql -p giá trị rời', {
  command: 'mysql', args: ['-u', 'root', '-p', KEY],
}, [KEY]);
surfaces('P411-1 mysql -p dính', {
  command: 'mysql', args: ['-p' + KEY],
}, [KEY]);
surfaces('P411-1 --api key', {
  command: 'qa-bin', args: ['--api', 'key', KEY],
}, [KEY]);
surfaces('P411-1 chuỗi lệnh QA_TOKEN', {
  command: 'QA_TOKEN=' + KEY + ' qa-bin', args: [],
}, [KEY]);

// P411-2: URL.
surfaces('P411-2 userinfo không có dấu hai chấm', {
  url: 'https://' + KEY + '@mcp.example.vn/sse',
}, [KEY]);
surfaces('P411-2 redis user rỗng', {
  url: 'redis://:' + KEY + '@10.0.0.5:6379',
}, [KEY]);
surfaces('P411-2 fragment access_token', {
  url: 'https://h.example/cb#access_token=' + KEY,
}, [KEY]);
surfaces('P411-2 tên query mã hoá api_key', {
  url: 'https://h.example/cb?api%5Fkey=' + KEY,
}, [KEY]);
surfaces('P411-2 tên query mã hoá token', {
  url: 'https://h.example/cb?tok%65n=' + KEY,
}, [KEY]);
surfaces('P411-2 jwt session private_token x-api-key', {
  url: 'https://h.example/cb?jwt=' + KEY + '&session=' + KEY + '&private_token=' + KEY + '&x-api-key=' + KEY,
}, [KEY]);

// P411-3: tên env ngắn, camelCase lồng sâu, dòng nhật ký tự do.
surfaces('P411-3 env PAT DSN BEARER JWT OTP', {
  command: 'qa-bin',
  env: { PAT: 'zqpat', DSN: 'zqdsn', BEARER: 'zqbearer', JWT: 'zqjwt', OTP: 'zqotp' },
}, ['zqpat', 'zqdsn', 'zqbearer', 'zqjwt', 'zqotp']);
surfaces('P411-3 camelCase lồng sâu', {
  command: 'qa-bin',
  q: { command: 'qa-bin', options: { auth: {
    refreshToken: KEY,
    idToken: 'id' + KEY,
    sessionToken: 'se' + KEY,
    bearerToken: 'be' + KEY,
    apiToken: 'ap' + KEY,
  } } },
}, [KEY, 'id' + KEY, 'se' + KEY, 'be' + KEY, 'ap' + KEY]);

test('[r6] P411-3 dòng nhật ký tự do', () => {
  const line = 'token=' + KEY + ' password=' + KEY + ' apiToken=' + KEY + ' OPENAI_API_KEY=' + KEY + ' https://' + KEY + '@host';
  for (const text of [line, 'Error: ' + line]) {
    const r = LOG.redact(text);
    assert.ok(!r.includes(KEY));
    assert.ok(r.includes('••••'));
    assert.ok(r.includes('@host'));
  }
});

test('[r6] FP AUTHOR KEYBOARD_LAYOUT MAX_TOKENS auth none MODEL gguf sha digest uuid path', () => {
  const sha = hexChars(40);
  const digest = hexChars(64);
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  const line = 'AUTHOR=Khoi KEYBOARD_LAYOUT=us MAX_TOKENS=4096 --auth none MODEL=Qwen.gguf ' + sha + ' ghcr.io/a/b@sha256:' + digest + ' file.gguf ' + uuid + ' /home/a/m.gguf';
  const r = LOG.redact(line);
  for (const bit of ['AUTHOR=Khoi', 'KEYBOARD_LAYOUT=us', '4096', '--auth none', 'Qwen.gguf', sha, 'sha256:' + digest, 'file.gguf', uuid, '/home/a/m.gguf']) {
    assert.ok(r.includes(bit), 'FP bị che ' + bit.slice(0, 40));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p12r6-'));
  try {
    const def = {
      command: 'qa-bin',
      args: ['--auth', 'none', '--rev', sha, 'ghcr.io/a/b@sha256:' + digest, '/home/a/m.gguf'],
      env: { AUTHOR: 'Khoi', KEYBOARD_LAYOUT: 'us', MAX_TOKENS: '4096', MODEL: 'Qwen.gguf', RUN_ID: uuid },
    };
    const ex = P.extractSecrets({ mcpServers: { s1: def } }, null);
    assert.strictEqual(ex.count, 0);
    const saved = JSON.stringify(ex.cfg);
    for (const bit of ['Khoi', 'us', '4096', 'none', 'Qwen.gguf', sha, digest, uuid, '/home/a/m.gguf']) {
      assert.ok(saved.includes(bit), 'FP mcp.json mất ' + bit.slice(0, 24));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('[r6] LOG.redact vòng tự tham chiếu trả [Circular]', () => {
  const o = { token: KEY };
  o.a = o;
  o.b = o;
  o.c = o;
  o.d = o;
  const t0 = Date.now();
  const r = LOG.redact(o);
  assert.ok(Date.now() - t0 < 1000);
  const text = JSON.stringify(r);
  assert.ok(text.includes('[Circular]'));
  assert.ok(!text.includes(KEY));
  assert.strictEqual(r.a, '[Circular]');
  assert.strictEqual(r.token, '***');
});
