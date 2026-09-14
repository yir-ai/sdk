import assert from 'node:assert/strict';
import test from 'node:test';
import { models, preview, verifyPrice } from '../examples/pricing.mjs';

test('local retail example previews and verifies the same snapshot without network', () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('pricing must not fetch'); };
  try {
    assert.equal(preview(5).amount, '2000');
    const price = preview(10);
    const input = {model:'demo/video',operation:'generate_video',parameters:{duration:10,audio:false},version:models.version};
    assert.deepEqual(verifyPrice(input, price.amount), price);
    assert.throws(() => verifyPrice({...input,version:'old'}, price.amount), /version_mismatch/);
    assert.throws(() => verifyPrice(input, '2000'), /price_changed/);
    assert.equal(preview(7).reason, 'no_match');
  } finally { globalThis.fetch = oldFetch; }
});
