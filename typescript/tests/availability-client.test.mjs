import assert from 'node:assert/strict';
import test from 'node:test';
import { createYirClient, validateGeneration, YirAPIError } from '../dist/index.js';
import { catalog } from './catalog-fixture.mjs';

const request = { model: 'openai/gpt-image-2', input: { type: 'text', prompt: 'fixture' },
  parameters: { resolution: 'future-resolution', future_parameter: true } };

test('stale model rules cannot veto a submit; explicit validation remains available', async () => {
  let sent;
  const client = createYirClient(async value => { sent = value; return { id: 'fixture', status: 'queued' }; }, catalog);
  await client.submitImage(request, 'saved-key');
  assert.deepEqual(sent.body, request);
  assert.throws(() => validateGeneration('generate_image', request, catalog));
});

test('failed submit exposes its generated key without replacing APIError identity or logging the key', async () => {
  let sent;
  const failure = new YirAPIError({ message: 'unavailable', status: 503 });
  const client = createYirClient(async value => { sent = value; throw failure; });
  await assert.rejects(client.submitImage(request), error => {
    assert.equal(error, failure);
    assert.equal(error.idempotencyKey, sent.headers['Idempotency-Key']);
    assert.ok(error.idempotencyKey);
    assert.equal(JSON.stringify(error).includes(error.idempotencyKey), false);
    return true;
  });
});

test('frozen transport errors still expose recovery identity through the submit error', async () => {
  const failure = Object.freeze(new TypeError('network'));
  const client = createYirClient(() => { throw failure; });
  await assert.rejects(client.submitImage(request, 'persisted'), error => {
    assert.equal(error.idempotencyKey, 'persisted');
    assert.equal(error.cause, failure);
    return true;
  });
});

test('balance supports debt, preserves added fields, and rejects malformed monetary data', async () => {
  const response = { object: 'balance', currency: 'USD', available_amount: '-0.10', held_amount: '0.00', total_amount: '-0.10', future: true };
  const client = createYirClient(async value => { assert.equal(value.path, '/v1/balance'); return response; });
  assert.deepEqual(await client.getBalance(), response);
  for (const held_amount of ['-1', 'NaN', 0]) {
    const invalid = createYirClient(async () => ({ ...response, held_amount }));
    await assert.rejects(invalid.getBalance(), /balance_response_invalid/);
  }
});
