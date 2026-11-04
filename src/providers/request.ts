import { BRIDGE_ERRORS, BridgeError, asBridgeError } from '../errors/index.js';
import { InvalidBridgeProviderError } from './errors.js';
import type { BridgeServiceRequest, BridgeVerificationProvider } from './types.js';

export const BRIDGE_PROVIDER_ORIGINS = Object.freeze({
  relay: 'https://api.relay.link',
  socket: 'https://public-backend.socket.tech',
  socketDedicated: 'https://dedicated-backend.socket.tech',
  layerswap: 'https://api.layerswap.io',
});

export const requestProvider = async (
  request: BridgeServiceRequest,
  timeoutMs: number,
  provider: BridgeVerificationProvider,
  path: string,
  body?: unknown,
  socketApi: 'public' | 'dedicated' = 'public'
): Promise<unknown> => {
  // Paths are constructed by the SDK. Never follow endpoints in a quote response.
  const allowed = provider === 'relay'
    ? path === '/chains' || path === '/quote/v2'
    : provider === 'socket' ? path.startsWith('/v3/swap/quote?')
      : /^\/api\/v2\/explorer\/0x[0-9a-f]{40}\?page=[1-9][0-9]*$/i.test(path);
  if (!allowed) throw new InvalidBridgeProviderError(provider, BRIDGE_ERRORS.UNSUPPORTED_SERVICE_PATH);
  const requestKind = provider === 'relay' ? (path === '/chains' ? 'relay_chains' : 'relay_quote')
    : provider === 'socket' ? 'socket_quote' : 'layerswap_orders';
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => request({
        url: (provider === 'socket' && socketApi === 'dedicated'
          ? BRIDGE_PROVIDER_ORIGINS.socketDedicated : BRIDGE_PROVIDER_ORIGINS[provider]) + path,
        method: body === undefined ? 'GET' : 'POST',
        body,
        timeoutMs,
        signal: controller.signal,
      })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new InvalidBridgeProviderError(provider, BRIDGE_ERRORS.REQUEST_TIMED_OUT));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    const failure = asBridgeError(error, BRIDGE_ERRORS.SERVICE_REQUEST_FAILED, { requestKind });
    if (failure instanceof InvalidBridgeProviderError) throw failure;
    // Do not propagate provider bodies, wallet addresses or request details as errors.
    throw new InvalidBridgeProviderError(provider, failure);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/** Minimal Fetch surface supported by browser service workers and React Native. */
export type BridgeFetch = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  credentials: 'omit';
  redirect: 'error';
}) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

/** No global fetch dependency: each host supplies its own transport explicitly. */
export const createBridgeFetchRequest = (fetch: BridgeFetch): BridgeServiceRequest => async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: { Accept: 'application/json', ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    signal: request.signal,
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok) throw new BridgeError(BRIDGE_ERRORS.PROVIDER_HTTP_ERROR, { httpStatus: response.status });
  try { return await response.json(); }
  catch { throw new BridgeError(BRIDGE_ERRORS.PROVIDER_RESPONSE_IS_NOT_VALID_JSON); }
};
