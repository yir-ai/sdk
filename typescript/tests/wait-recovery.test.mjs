import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForJob, YirAPIError, YirTimeoutError, createNodeYirClient } from '../dist/index.js';

test('wait survives exhausted transport retries and reads the original job', async () => {
  let calls = 0;
  const client = createNodeYirClient({ apiKey: 'fixture', fetch: async (url) => {
    assert.match(String(url), /\/v1\/jobs\/101(?:\/status)?(?:\?|$)/);
    calls++;
    if (calls <= 4) return new Response('restarting', { status: 503 });
    return Response.json({ id: '101', status: 'succeeded' });
  }});
  const job = await waitForJob(client, '101', { timeoutMs: 15000 });
  assert.equal(job.id, '101');
  assert.equal(calls, 6);
});

test('final detail read recovers without repeating submit or status', async () => {
  let details = 0, statuses = 0;
  const job = await waitForJob({
    getJobStatus: async () => { statuses++; return {id:'101',status:'succeeded'}; },
    getJob: async () => { if (++details === 1) throw new TypeError('fetch failed'); return {id:'101',status:'succeeded'}; },
  }, '101', { timeoutMs: 5000 });
  assert.equal(job.id,'101'); assert.equal(details,2); assert.equal(statuses,1);
});

test('outage honors total timeout, abort and permanent errors', async () => {
  const client = { getJobStatus: async () => { throw new YirAPIError({message:'restarting',status:503}); }, getJob: async () => { throw new Error('unexpected'); } };
  await assert.rejects(waitForJob(client,'101',{timeoutMs:30}), YirTimeoutError);
  const controller = new AbortController();
  const pending = waitForJob(client,'101',{timeoutMs:5000,signal:controller.signal});
  controller.abort(new Error('caller stopped'));
  await assert.rejects(pending,/caller stopped/);
  let calls = 0;
  await assert.rejects(waitForJob({...client, getJobStatus: async () => { calls++; throw new YirAPIError({message:'unauthorized',status:401}); }},'101'), /unauthorized/);
  assert.equal(calls,1);
});
