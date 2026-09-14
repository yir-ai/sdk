import test from 'node:test';
import assert from 'node:assert/strict';
import {publishRetailTable, priceOrder} from '../examples/retail-table.mjs';

test('customer retail publication rounds complete totals and preserves the source', () => {
  const cost = {format:'yir-price-table-v1',version:'cost-v1',purpose:'yir-cost',unit:'USD',scale:1000000,
    rows:[{id:'one',model:'demo/video',operation:'generate_video',conditions:{duration:[5]},kind:'exact',price:{type:'total',amount:'184001'}}]};
  const before = structuredClone(cost);
  const table = publishRetailTable(cost, 'retail-v1');
  assert.deepEqual(cost, before);
  assert.equal(table.rows[0].price.amount, '24');
  const input = {model:'demo/video',operation:'generate_video',parameters:{duration:5},version:table.version};
  const store = new Map([[table.version,table]]);
  assert.equal(priceOrder(store,input).amount,'24');
  assert.throws(()=>priceOrder(store,{...input,version:'expired'}),/price_version_expired/);
  assert.throws(()=>priceOrder(store,{...input,parameters:{duration:10}}),/price_unavailable/);
  assert.throws(()=>priceOrder(new Map([[cost.version,cost]]),{...input,version:cost.version}),/price_unavailable/);
  const unit = structuredClone(cost);
  unit.rows[0].price = {type:'unit',amount:'1',quantity:'duration',per:'1',rounding:'ceil'};
  assert.throws(()=>publishRetailTable(unit,'retail-v2'),/exact_total_required/);
});
