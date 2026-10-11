import { createNodeHttpTransport, type CreateNodeYirClientOptions, type YirRequestOptions, type YirTransportRequest } from './client.js';
import type * as T from '../shared/account-types.js';
export type * from '../shared/account-types.js';

export const DEFAULT_ACCOUNT_BASE_URL = 'https://api.yir.ai/account/v1';
export type AccountQuery = Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>;
export type AccountClientOptions = Omit<CreateNodeYirClientOptions, 'modelContracts'>;

/** Account API client. It never falls back to YIR_API_KEY or YIR_BASE_URL. */
export function createAccountClient(options: AccountClientOptions = {}) {
  const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const apiKey = options.apiKey ?? env?.YIR_ACCOUNT_API_KEY;
  if (!apiKey?.startsWith('yir_ak_') || /\s/.test(apiKey)) throw new Error('account_key_required');
  const baseURL = options.baseURL ?? DEFAULT_ACCOUNT_BASE_URL;
  const url = new URL(baseURL);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('base_url_invalid');
  const transport = createNodeHttpTransport({ ...options, apiKey, baseURL });
  async function request<R>(method: YirTransportRequest['method'], path: string, body?: unknown, query?: AccountQuery, opts?: YirRequestOptions): Promise<R> {
    const params = new URLSearchParams();
    for (const [key,value] of Object.entries(query ?? {})) if (value !== undefined) params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    const suffix = params.size ? `?${params}` : '';
    const result = await transport<{ code: number; data?: R }>({ method, path: path + suffix, ...(body === undefined ? {} : { body }), ...(opts?.signal ? { signal: opts.signal } : {}) });
    if (result?.code !== 200) throw new Error('account_response_invalid');
    return result.data as R;
  }
  const id = (value: string) => { if (!/^[1-9]\d{0,18}$/.test(value)) throw new Error('account_id_invalid'); return value; };
  return {
    analytics: { get: (query?: AccountQuery, opts?: YirRequestOptions) => request<T.AccountAnalyticsResult>('GET','/analytics',undefined,query,opts) },
    logs: {
      list: (query?: AccountQuery, opts?: YirRequestOptions) => request<T.AccountTaskListResult>('GET','/logs',undefined,query,opts),
      get: (value: string, opts?: YirRequestOptions) => request<T.AccountTaskDetail>('GET',`/logs/${id(value)}`,undefined,undefined,opts),
    },
    routingProfiles: {
      list: () => request<T.AccountRoutingProfileView[]>('GET','/routing-profiles'),
      create: (input: T.AccountCreateRoutingProfile) => request<T.AccountRoutingProfileView>('POST','/routing-profiles',input),
      update: (value: string, input: T.AccountUpdateRoutingProfile) => request<T.AccountRoutingProfileView>('PATCH',`/routing-profiles/${id(value)}`,input),
      archive: (value: string) => request<void>('DELETE',`/routing-profiles/${id(value)}`),
    },
    webhooks: {
      list: () => request<T.AccountWebhookEndpointListResult>('GET','/webhook-endpoints'),
      get: (value: string) => request<T.AccountWebhookEndpointView>('GET',`/webhook-endpoints/${id(value)}`),
      create: (input: T.AccountWebhookEndpointCreate) => request<T.AccountWebhookEndpointView>('POST','/webhook-endpoints',input),
      update: (value: string, input: T.AccountWebhookEndpointUpdate) => request<T.AccountWebhookEndpointView>('PATCH',`/webhook-endpoints/${id(value)}`,input),
      delete: (value: string) => request<void>('DELETE',`/webhook-endpoints/${id(value)}`),
      deliveries: (value: string, query?: AccountQuery) => request<T.AccountWebhookDeliveryListResult>('GET',`/webhook-endpoints/${id(value)}/deliveries`,undefined,query),
    },
    alerts: {
      get: () => request<T.AccountUserAlertSetting>('GET','/alerts/settings'),
      update: (input: T.AccountUpdateYIRUserAlertSetting) => request<T.AccountUserAlertSetting>('PUT','/alerts/settings',input),
    },
    lowBalanceAlert: {
      get: () => request<T.AccountLowBalanceAlertSetting>('GET','/wallet/low-balance-alert'),
      update: (input: T.AccountUpdateLowBalanceAlertSetting) => request<T.AccountLowBalanceAlertSetting>('PUT','/wallet/low-balance-alert',input),
    },
  };
}
