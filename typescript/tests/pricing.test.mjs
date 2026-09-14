import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculatePrice, isPriceTable } from '@yir-ai/sdk/pricing';

const fixtures = JSON.parse(readFileSync(new URL('../../go/testdata/price-table-v1.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) {
  test(`shared pricing: ${fixture.name}`, () => {
    const before = JSON.stringify(fixture);
    assert.deepEqual(calculatePrice(fixture.table, fixture.input), fixture.expected);
    assert.equal(JSON.stringify(fixture), before, 'calculation must not mutate its inputs');
  });
}
test('reject malformed table and input without throwing', () => {
  for (const table of [null, [], {}, { ...fixtures[0].table, rows: null }]) {
    assert.equal(isPriceTable(table), false);
    assert.deepEqual(calculatePrice(table, fixtures[0].input), {kind:'unavailable', reason:'invalid_table'});
  }
  assert.deepEqual(calculatePrice(fixtures[0].table, null), {kind:'unavailable', reason:'invalid_input'});
});
test('all allowed quantities and rounding boundaries remain exact', () => {
  for (let quantity = 0; quantity <= 30; quantity++) {
    for (const rounding of ['ceil', 'floor', 'half-up']) {
      const table = structuredClone(fixtures[0].table);
      table.rows[0].conditions.duration = [quantity];
      table.rows[0].price = {type:'unit', quantity:'duration', amount:'7', per:'4', rounding};
      const input = {...fixtures[0].input, parameters:{duration:quantity,audio:false}};
      const expected = (rounding === 'ceil' ? Math.ceil : rounding === 'floor' ? Math.floor : Math.round)(quantity * 7 / 4);
      assert.equal(calculatePrice(table, input).amount, String(expected));
    }
  }
});
