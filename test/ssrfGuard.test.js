import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIPv4, isPrivateIPv6, assertPublicHost } from '../src/utils/ssrfGuard.js';

test('isPrivateIPv4 flags loopback, private, and link-local ranges', () => {
  assert.equal(isPrivateIPv4('127.0.0.1'), true);
  assert.equal(isPrivateIPv4('10.1.2.3'), true);
  assert.equal(isPrivateIPv4('172.16.5.5'), true);
  assert.equal(isPrivateIPv4('172.31.255.255'), true);
  assert.equal(isPrivateIPv4('192.168.1.1'), true);
  assert.equal(isPrivateIPv4('169.254.169.254'), true); // cloud metadata endpoint
  assert.equal(isPrivateIPv4('100.64.0.1'), true); // CGNAT
  assert.equal(isPrivateIPv4('0.0.0.0'), true);
});

test('isPrivateIPv4 does not flag ordinary public addresses', () => {
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
  assert.equal(isPrivateIPv4('1.1.1.1'), false);
  assert.equal(isPrivateIPv4('172.15.0.1'), false); // just outside 172.16/12
  assert.equal(isPrivateIPv4('172.32.0.1'), false); // just outside 172.16/12
});

test('isPrivateIPv6 flags loopback, link-local, and unique-local', () => {
  assert.equal(isPrivateIPv6('::1'), true);
  assert.equal(isPrivateIPv6('fe80::1'), true);
  assert.equal(isPrivateIPv6('fc00::1'), true);
  assert.equal(isPrivateIPv6('fd12:3456::1'), true);
});

test('isPrivateIPv6 flags IPv4-mapped private addresses', () => {
  assert.equal(isPrivateIPv6('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateIPv6('::ffff:10.0.0.1'), true);
});

test('isPrivateIPv6 does not flag ordinary public addresses', () => {
  assert.equal(isPrivateIPv6('2001:4860:4860::8888'), false); // Google public DNS
});

test('assertPublicHost rejects loopback literal IPs without DNS lookup', async () => {
  await assert.rejects(() => assertPublicHost('http://127.0.0.1/'), /private\/internal/);
});

test('assertPublicHost rejects private literal IPs', async () => {
  await assert.rejects(() => assertPublicHost('http://192.168.1.1/'), /private\/internal/);
});

test('assertPublicHost rejects "localhost" via DNS resolution', async () => {
  await assert.rejects(() => assertPublicHost('http://localhost/'), /private\/internal/);
});

test('assertPublicHost allows anything when allowPrivate is set', async () => {
  await assert.doesNotReject(() => assertPublicHost('http://127.0.0.1/', { allowPrivate: true }));
});

test('assertPublicHost rejects an invalid URL', async () => {
  await assert.rejects(() => assertPublicHost('not a url'), /Invalid URL/);
});
