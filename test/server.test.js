'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { app } = require('../server');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test('health endpoint reports service liveness and security headers', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.ok(Number.isInteger(body.uptimeSeconds));
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('unknown football league is rejected without upstream access', async () => {
  const response = await fetch(`${baseUrl}/api/standings/unknown`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /Unknown league/);
});

test('Brave search rejects malformed and oversized queries', async () => {
  const headers = { 'X-Api-Key': 'test-key' };
  const missing = await fetch(`${baseUrl}/api/search?q=`, { headers });
  const arrayQuery = await fetch(`${baseUrl}/api/search?q%5B%5D=test`, { headers });
  const oversized = await fetch(`${baseUrl}/api/search?q=${'x'.repeat(501)}`, { headers });

  assert.equal(missing.status, 400);
  assert.equal(arrayQuery.status, 400);
  assert.equal(oversized.status, 400);
  assert.match((await oversized.json()).error, /maximum 500 characters/);
});
