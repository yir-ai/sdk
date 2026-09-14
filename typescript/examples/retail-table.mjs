import { calculatePrice, isPriceTable } from '@yir/sdk/pricing';

// Customer backend example, not a Yir tariff policy: 25% markup,
// 100 credits per USD, rounded UP once per complete specification.
// Publish/store the returned snapshot; do not recalculate it at checkout.
export function publishRetailTable(cost, version) {
  if (!isPriceTable(cost) || cost.purpose !== 'yir-cost' || cost.unit !== 'USD' || cost.scale !== 1_000_000 || !version) {
    throw new Error('invalid_cost_table');
  }
  const table = structuredClone(cost);
  table.version = version;
  table.purpose = 'retail';
  table.unit = 'credit';
  table.scale = 1;
  for (const row of table.rows) {
    if (row.kind !== 'exact' || row.price.type !== 'total') throw new Error('exact_total_required');
    const numerator = BigInt(row.price.amount) * 125n;
    row.price.amount = ((numerator + 999999n) / 1000000n).toString();
  }
  if (!isPriceTable(table)) throw new Error('invalid_retail_table');
  return table;
}

// The application owns this trusted store and decides which versions remain
// accepted. A locally authored models.ts can be stored here in exactly the same way.
// Never accept a price table or a debit amount from the browser.
export function priceOrder(publishedTables, input) {
  const table = publishedTables.get(input.version);
  if (!table) throw new Error('price_version_expired');
  const result = calculatePrice(table, input);
  if (result.kind !== 'exact' || result.purpose !== 'retail') throw new Error('price_unavailable');
  return result;
  // Authentication, balance, idempotency, persistence and Yir max_cost belong
  // to the customer's checkout. This example does not place an order.
}
