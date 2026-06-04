import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUrl } from './browserManager.js';

test('normalizeUrl adds an HTTP protocol', () => {
  assert.equal(normalizeUrl('192.168.1.1'), 'http://192.168.1.1/');
});

test('normalizeUrl keeps HTTPS URLs', () => {
  assert.equal(normalizeUrl('https://router.local/login'), 'https://router.local/login');
});

test('normalizeUrl rejects unsupported protocols', () => {
  assert.throws(() => normalizeUrl('file:///etc/passwd'), /Only HTTP and HTTPS/);
});
