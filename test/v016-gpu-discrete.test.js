'use strict';
// Kiểm tra isDiscrete trong src/gpu-pick.js: nhận ra GPU rời (NVIDIA/AMD RX/Intel Arc A…) để AIVN ưu tiên chạy mô hình trên đó.
const test = require('node:test'); const assert = require('node:assert');
const { isDiscrete } = require('../src/gpu-pick');

test('isDiscrete: card NVIDIA và AMD Radeon RX là GPU rời', () => {
  assert.strictEqual(isDiscrete('NVIDIA GeForce RTX 3050 Ti Laptop GPU'), true);
  assert.strictEqual(isDiscrete('AMD Radeon RX 6600'), true);
});

test('isDiscrete: GPU tích hợp AMD/Intel không phải GPU rời', () => {
  assert.strictEqual(isDiscrete('AMD Radeon(TM) Graphics'), false);
  assert.strictEqual(isDiscrete('Intel(R) UHD Graphics 620'), false);
});

test('isDiscrete: CPU không phải GPU rời', () => {
  assert.strictEqual(isDiscrete('CPU'), false);
});