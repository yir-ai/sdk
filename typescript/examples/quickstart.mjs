import { buildImageQuoteRequest } from '@yir-ai/sdk/server';

// Quote on the server, then persist the request and a stable idempotency key.
// Submission and recovery must read that saved record.
// maxCost is optional: pass an approved cap only as a guard against runaway charges, not as a price lock.
// The application owns spend approval and storage; importing this module does not generate.
export async function prepareImage(client, input, maxCost) {
  if (maxCost !== undefined && (typeof maxCost !== 'string' || !maxCost)) throw new Error('max_cost_invalid');
  const request = buildImageQuoteRequest(input);
  const quote = await client.quoteImage(request);
  if (!quote.supply?.available || typeof quote.primary?.amount !== 'string') {
    throw new Error('supply_unavailable');
  }
  // expected_amount is what the Job will probably cost; the Job is charged the upstream amount.
  return { estimate: quote.expected_amount ?? quote.primary.amount, request: maxCost ? { ...request, max_cost: maxCost } : request };
}

export async function submitSavedImage(client, saved) {
  if (!saved?.idempotencyKey || !saved?.request?.model) {
    throw new Error('saved_authorization_required');
  }
  return client.submitImage(saved.request, saved.idempotencyKey);
}

// Integration order:
// 1. prepareImage(client, { model, prompt, parameters }) or, with a cap, prepareImage(client, input, approvedMaxCost)
// 2. Show the estimate, then persist request + stable idempotencyKey in your task record.
// 3. submitSavedImage(client, storedRecord)
// Recover by repeating step 3 with the saved request and key; never replace either.
