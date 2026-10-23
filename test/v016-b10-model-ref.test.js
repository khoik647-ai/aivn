'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolveModel } = require('../src/model-ref');

const rows = [
  { id: 'qwen2.5-3b-instruct-q4_k_m', file: 'qwen2.5-3b-instruct-q4_k_m.gguf' },
  { id: 'qwen2.5-7b-instruct-q4_k_m', file: 'qwen2.5-7b-instruct-q4_k_m.gguf' },
  { id: 'other-model', file: 'other-model.gguf' },
];

test('khớp đúng id, đúng tên tệp, rồi tiền tố duy nhất; "3b" không trúng qwen', () => {
  assert.strictEqual(resolveModel(rows, 'qwen2.5-7b-instruct-q4_k_m').id, 'qwen2.5-7b-instruct-q4_k_m');
  assert.strictEqual(resolveModel(rows, 'Qwen2.5-7b-instruct-q4_k_m.gguf').id, 'qwen2.5-7b-instruct-q4_k_m');
  assert.strictEqual(resolveModel(rows, 'qwen2.5-7b-instruct').id, 'qwen2.5-7b-instruct-q4_k_m');
  assert.strictEqual(resolveModel(rows, '3b'), null);
  assert.strictEqual(resolveModel(rows, 'qwen'), null);
  assert.strictEqual(resolveModel(rows, 'gpt-4o-mini'), null);
});
