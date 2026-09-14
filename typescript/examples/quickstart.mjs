import { buildImageQuoteRequest } from '@yir-ai/sdk/server';

// Quote on the server. Persist the returned request with a stable idempotency key.
// Submission and recovery must read that saved record.
// The application owns budget approval and storage; importing this module does not generate.
export async function prepareImage(client, input) {
  const request = buildImageQuoteRequest(input);
  const quote = await client.quoteImage(request);
  if (!quote.supply?.available || quote.primary?.kind !== 'fixed' ||
      !quote.has_verifiable_upper_bound || typeof quote.single_attempt_upper_bound !== 'string') {
    throw new Error('verifiable_budget_required');
  }
  return { request: { ...request, max_cost: quote.single_attempt_upper_bound } };
}

export async function submitSavedImage(client, saved) {
  if (!saved?.idempotencyKey || !saved?.request?.max_cost) {
    throw new Error('saved_authorization_required');
  }
  return client.submitImage(saved.request, saved.idempotencyKey);
}

// Integration order:
// 1. prepareImage(client, { model, prompt, parameters })
// 2. Approve the budget and persist request + stable idempotencyKey in your task record.
// 3. submitSavedImage(client, storedRecord)
// Recover by repeating step 3 with the saved request and key; never replace either.
