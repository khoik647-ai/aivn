// Chặn phát hành khi còn lỗi chính tả chưa duyệt (hunspell vi_VN + en_US, danh sách cho phép docs/spelling-allow.txt)
const test = require('node:test'); const assert = require('node:assert'); const path = require('path'); const { spawnSync } = require('child_process');
test('chính tả giao diện và trang web: không còn từ chưa duyệt', () => {
  const h = spawnSync('hunspell', ['-D'], { encoding: 'utf8', input: '' });
  assert.ok(!h.error, 'Thiếu hunspell: cài hunspell hunspell-vi hunspell-en-us rồi chạy lại');
  assert.ok(/vi_VN/.test(h.stderr + h.stdout) && /en_US/.test(h.stderr + h.stdout), 'Thiếu từ điển hunspell vi_VN hoặc en_US');
  const r = spawnSync('python3', [path.join(__dirname, '..', 'tools', 'spellcheck.py')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'Từ chưa duyệt (sửa chính tả hoặc thêm vào docs/spelling-allow.txt sau khi soát):\n' + r.stdout);
});
