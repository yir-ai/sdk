import { calculatePrice } from '@yir/sdk/pricing';

// Customer-owned retail prices; these are not Yir procurement rates or real model IDs.
export const models = {
  format: 'yir-price-table-v1', version: 'retail-2026-09-11',
  purpose: 'retail', unit: 'credit', scale: 100,
  rows: [
    {id:'video-5s', model:'demo/video', operation:'generate_video',
      conditions:{duration:[5],audio:[false]}, kind:'exact', price:{type:'total',amount:'2000'}},
    {id:'video-10s', model:'demo/video', operation:'generate_video',
      conditions:{duration:[10],audio:[false]}, kind:'exact', price:{type:'total',amount:'4000'}},
  ],
};

// Browser: no API call when duration changes. Pass the same table through import,
// page props, or your existing data-fetching layer.
export function preview(duration) {
  return calculatePrice(models, {
    model:'demo/video', operation:'generate_video',
    parameters:{duration,audio:false}, version:models.version,
  });
}

// Backend: load YOUR trusted table; never use a table supplied by the browser.
// This bounded example validates retail pricing, not authorization or a whole checkout.
export function verifyPrice(input, displayedAmount) {
  const result = calculatePrice(models, input);
  if (result.kind !== 'exact') throw new Error(result.kind === 'unavailable' ? result.reason : 'exact_retail_price_required');
  if (result.amount !== displayedAmount) throw new Error('price_changed');
  return result;
  // The application then checks membership, balance and idempotency, persists
  // the accepted retail snapshot, and submits to Yir with its own max_cost.
  // Yir's eventual charge does not replace this retail credit amount.
}
