import { buildImageQuoteRequest } from '@yir-ai/sdk/server';

// Quote on the server, then persist the request with your approved max_cost and a stable idempotency key.
// Submission and recovery must read that saved record.
// The application owns budget approval and storage; importing this module does not generate.
export async function prepareImage(client, input, maxCost) {
  if (typeof maxCost !== 'string' || !maxCost) throw new Error('approved_budget_required');
  const request = buildImageQuoteRequest(input);
  const quote = await client.quoteImage(request);
  if (!quote.supply?.available || typeof quote.primary?.amount !== 'string') {
    throw new Error('supply_unavailable');
  }
  // primary is an estimate; the Job is charged the upstream amount, capped by max_cost.
  return { estimate: quote.primary.amount, request: { ...request, max_cost: maxCost } };
}

export async function submitSavedImage(client, saved) {
  if (!saved?.idempotencyKey || !saved?.request?.max_cost) {
    throw new Error('saved_authorization_required');
  }
  return client.submitImage(saved.request, saved.idempotencyKey);
}

// Integration order:
// 1. prepareImage(client, { model, prompt, parameters }, approvedMaxCost)
// 2. Show the estimate, then persist request + stable idempotencyKey in your task record.
// 3. submitSavedImage(client, storedRecord)
// Recover by repeating step 3 with the saved request and key; never replace either.
