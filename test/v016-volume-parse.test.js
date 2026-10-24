'use strict';
// Kiểm tra volumeParse trong src/agent/sys-intent.js: hiểu câu lệnh âm lượng thành mức cố định hoặc mức tăng/giảm.
const test = require('node:test'); const assert = require('node:assert');
const { volumeParse } = require('../src/agent/sys-intent');

test('volumeParse: "đặt âm lượng 30" là đặt mức 30', () => {
  assert.deepStrictEqual(volumeParse('đặt âm lượng 30'), { level: 30 });
});

test('volumeParse: tăng/giảm âm lượng là thay đổi tương đối', () => {
  assert.deepStrictEqual(volumeParse('tăng âm lượng thêm 10'), { delta: 10 });
  assert.deepStrictEqual(volumeParse('giảm âm lượng 20'), { delta: -20 });
});

test('volumeParse: câu phủ định hoặc câu hỏi thì không đổi âm lượng', () => {
  assert.strictEqual(volumeParse('đừng tăng âm lượng 50'), null);
  assert.strictEqual(volumeParse('âm lượng bao nhiêu?'), null);
});