import { buildImageQuoteRequest } from '@yir/sdk/server';

// 服务端先报价。返回值和幂等键必须一起持久化，提交/恢复只读取保存的请求。
// 此模块不自动生成、不创建临时幂等键，也不承担客户的账户/订单授权。
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

// 集成顺序：
// 1. prepareImage(client, { model, prompt, parameters })
// 2. 客户后端核准预算，将 request 与稳定 idempotencyKey 保存到自己的订单/任务记录。
// 3. submitSavedImage(client, storedRecord)
// 恢复时重复步骤 3；不得重新报价替换已有 request 或重新生成幂等键。
