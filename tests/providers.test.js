import fs from 'node:fs';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
  buildTx, createBridgeFetchRequest, createBridgeProviderClient,
  getQuote, InvalidBridgeProviderError,
} from '../dist/index.js';
import { relayChains } from '../dist/providers/relay.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/providers/${name}-20261103.json`, import.meta.url)));
const relay = load('relay-v2');
const socket = load('socket-v3');
const pending = load('layerswap-pending');
const completed = load('layerswap-completed');
const clone = (value) => JSON.parse(JSON.stringify(value));
const attacker = '0x0000000000000000000000000000000000000001';
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

afterEach(() => jest.restoreAllMocks());

const direct = (provider, body = provider === 'relay' ? relay.response : socket.response) => {
  const fixture = provider === 'relay' ? relay : socket;
  const request = jest.fn(async ({ url }) => clone(url.endsWith('/chains') ? relay.chains : body));
  const client = createBridgeProviderClient({ request });
  const api = {
    getBridgeQuoteListV2: jest.fn(async () => []),
    buildBridgeTx: jest.fn(async () => { throw new Error('Unexpected backend build'); }),
  };
  return { client, request, api, params: { ...fixture.params, providerClient: client } };
};

const layer = (fixture = pending, response = fixture.providerResponse) => {
  const request = jest.fn(async () => clone(response));
  const client = createBridgeProviderClient({ request });
  const params = {
    userAddress: fixture.tx.from, fromChainId: 'eth', fromTokenId: fixture.expected.sourceToken,
    fromTokenRawAmount: fixture.expected.sourceAmount, toChainId: 'arb', toTokenId: fixture.expected.outputToken,
    toTokenRawAmount: fixture.expected.expectedOutputAmount, slippage: '0.01', feeRate: 0.25,
    bridgeId: 'layerswap', quoteKey: fixture.quote?.quote_key, providerClient: client,
  };
  const api = { buildBridgeTx: jest.fn(async () => clone(fixture.tx)) };
  return { client, request, params, api };
};

describe('direct provider verification', () => {
  const cases = [
    ['relay', 'relay', relay.expected, relay.tx],
    ...socket.cases.map((item) => ['socket', item.bridgeId, item.expected, item.tx]),
  ];
  test.each(cases)('%s/%s binds all five expected fields without expiry checks', async (provider, bridgeId, expected, sourceTx) => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2100, 0, 1));
    const { client, request, params, api } = direct(provider);
    const quotes = await getQuote(provider, params, api);
    expect(quotes).toHaveLength(provider === 'relay' ? 1 : 3);
    expect(api.getBridgeQuoteListV2).toHaveBeenCalledTimes(provider === 'relay' ? 0 : 1);
    const quote = quotes.find((item) => item.bridge_id === bridgeId);
    expect(quote).toBeDefined();
    {
      const build = { ...params, bridgeId: quote.bridge_id, quoteKey: quote.quote_key,
        toTokenRawAmount: quote.to_token_raw_amount_hex_str };
      const tx = await buildTx(provider, build, api);
      Date.now.mockReturnValue(Date.UTC(2101, 0, 1));
      const verified = client.verifyTx(provider, build, tx);
      expect(tx.from).toBe(sourceTx.from.toLowerCase());
      expect(tx.to).toBe(sourceTx.to.toLowerCase());
      expect(tx.data).toBe(sourceTx.data.toLowerCase());
      expect(BigInt(tx.value)).toBe(BigInt(sourceTx.value));
      expect(verified.parsed.sourceToken).toBe(expected.sourceToken);
      expect(verified.parsed.sourceAmount).toBe(BigInt(expected.sourceAmount));
      expect(verified.parsed.outputToken).toBe(expected.outputToken);
      expect(verified.parsed.minOutputAmount).toBe(BigInt(expected.minOutputAmount));
      expect(verified.parsed.receiver).toBe(expected.receiver);
      expect(verified.parsed.destinationChainId).toBe(BigInt(expected.destinationChainId));
      expect(verified.parsed.unresolvedFields).toEqual([]);
      expect(verified).not.toHaveProperty('expiresAt');
      if (provider === 'relay') expect(verified.parsed.orderId).toBe(relay.expected.orderId);
      for (const changed of [{ to: attacker }, { from: attacker }, { value: '1' },
        { chainId: 1 }, { data: tx.data + '00' }]) {
        expect(() => client.verifyTx(provider, build, { ...tx, ...changed })).toThrow(InvalidBridgeProviderError);
      }
      for (const changed of [{ fromTokenRawAmount: '4000001' }, { toTokenId: attacker },
        { toChainId: 'op' }, { slippage: '0.02' }, { feeRate: 0.5 }]) {
        await expect(buildTx(provider, { ...build, ...changed }, api)).rejects.toThrow(InvalidBridgeProviderError);
      }
    }
    expect(api.buildBridgeTx).not.toHaveBeenCalled();
    expect(request.mock.calls.every(([call]) => call.url.startsWith(provider === 'relay'
      ? 'https://api.relay.link/' : 'https://public-backend.socket.tech/'))).toBe(true);
  });

  test('Relay reuses quote protocol data for building and signing with cached chain metadata', async () => {
    const { client, request, params, api } = direct('relay');
    const [quote] = await getQuote('relay', params, api);
    expect(request.mock.calls.map(([call]) => [call.method, call.url])).toEqual([
      ['GET', 'https://api.relay.link/chains'],
      ['POST', 'https://api.relay.link/quote/v2'],
    ]);
    expect(request.mock.calls[1][0].body.includeProtocolData).toBe(true);

    const build = { ...params, bridgeId: quote.bridge_id, quoteKey: quote.quote_key,
      toTokenRawAmount: quote.to_token_raw_amount_hex_str };
    const tx = await buildTx('relay', build, api);
    expect(client.verifyTx('relay', build, tx).parsed.orderId).toBe(relay.expected.orderId);
    await expect(buildTx('relay', build, api)).resolves.toEqual(tx);
    expect(request).toHaveBeenCalledTimes(2);
    expect(api.getBridgeQuoteListV2).not.toHaveBeenCalled();
    expect(api.buildBridgeTx).not.toHaveBeenCalled();

    client.clear();
    await getQuote('relay', params, api);
    expect(request.mock.calls.map(([call]) => [call.method, call.url])).toEqual([
      ['GET', 'https://api.relay.link/chains'],
      ['POST', 'https://api.relay.link/quote/v2'],
      ['POST', 'https://api.relay.link/quote/v2'],
    ]);
  });

  test.each(['protocol', 'orderData'])('Relay rejects missing %s directly from the quote response', async (field) => {
    const response = clone(relay.response);
    if (field === 'protocol') delete response.protocol;
    else delete response.protocol.v2.orderData;
    const { request, params, api } = direct('relay', response);
    await expect(getQuote('relay', params, api)).rejects.toThrow(InvalidBridgeProviderError);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([call]) => call.url)).toEqual([
      'https://api.relay.link/chains',
      'https://api.relay.link/quote/v2',
    ]);
    expect(api.getBridgeQuoteListV2).not.toHaveBeenCalled();
    expect(api.buildBridgeTx).not.toHaveBeenCalled();
  });

  test.each(['recipient', 'minimumAmount', 'deadline'])('Relay rejects changed hashed %s', async (field) => {
    const response = clone(relay.response);
    const output = response.protocol.v2.orderData.output;
    if (field === 'recipient') output.payments[0].recipient = attacker;
    if (field === 'minimumAmount') output.payments[0].minimumAmount = '1';
    if (field === 'deadline') output.deadline = 0;
    const { params, api } = direct('relay', response);
    await expect(getQuote('relay', params, api)).rejects.toThrow('order hash does not match');
  });

  test('Relay rejects service metadata that relabels a protocol destination chain', () => {
    const metadata = clone(relay.chains);
    metadata.chains.find((chain) => chain.protocol.v2.chainId === 'base').id = 10;
    expect(() => relayChains(metadata)).toThrow('Relay protocol chain mismatch');
  });

  test('Relay rejects replacing its depository with an otherwise allowed legacy router', async () => {
    const metadata = clone(relay.chains), response = clone(relay.response);
    const replacement = '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f';
    const original = response.protocol.v2.paymentDetails.depository.toLowerCase();
    metadata.chains.forEach((chain) => { chain.protocol.v2.depository = replacement; });
    response.protocol.v2.paymentDetails.depository = replacement;
    for (const step of response.steps) for (const item of step.items) {
      if (item.data.to.toLowerCase() === original) item.data.to = replacement;
      item.data.data = item.data.data.replaceAll(original.slice(2), replacement.slice(2));
    }
    const client = createBridgeProviderClient({ request: async ({ url }) => url.endsWith('/chains') ? metadata : response });
    await expect(client.getQuotes('relay', relay.params)).rejects.toThrow('Relay canonical depository mismatch');
  });

  test.each(socket.response.result.routes.flatMap((route) =>
    ['target', 'spender', 'value', 'token', 'amount'].map((field) => [route.routeDetails.bridgeDetails.protocol.name, field])
  ))('Socket %s rejects a changed source %s', async (bridgeId, field) => {
    const response = clone(socket.response);
    const route = response.result.routes.find((item) => item.routeDetails.bridgeDetails.protocol.name === bridgeId);
    const tx = route.txData.object;
    const replaceWord = (offset, value) => {
      tx.data = tx.data.slice(0, offset) + value.replace(/^0x/, '').padStart(64, '0') + tx.data.slice(offset + 64);
    };
    if (field === 'value') tx.value = '1000000000000000000';
    else if (field === 'target' || field === 'spender') {
      const dataOffsetWord = 2 + 8 + 4 * 64;
      const dataOffset = Number(BigInt('0x' + tx.data.slice(dataOffsetWord, dataOffsetWord + 64)));
      const routerOffset = 2 + (4 + dataOffset + 32) * 2;
      replaceWord(routerOffset + 8 + (field === 'target' ? 6 : 7) * 64, attacker);
    } else {
      const rfq = bridgeId === 'rfq-vault-executor';
      const offset = tx.data.indexOf(rfq ? '823b01f9' : '8e0250ee') + 8;
      replaceWord(offset + (field === 'token' ? (rfq ? 1 : 3) : (rfq ? 2 : 0)) * 64,
        field === 'token' ? attacker : '1');
    }
    const { client, params } = direct('socket', response);
    await expect(client.getQuotes('socket', params)).rejects.toThrow(InvalidBridgeProviderError);
  });

  test('Socket rejects a provider minimum below the local slippage bound', async () => {
    const response = clone(socket.response);
    response.result.routes[0].output.minAmountOut = '1';
    const { client, params } = direct('socket', response);
    await expect(client.getQuotes('socket', params)).rejects.toThrow('min_receive');
  });

  test('Socket rejects an old selection when a reused quote ID changes its output amount', async () => {
    const response = clone(socket.response);
    const { client, request, params, api } = direct('socket');
    const [quote] = await getQuote('socket', params, api);
    const build = { ...params, bridgeId: quote.bridge_id, quoteKey: clone(quote.quote_key) };
    const route = response.result.routes.find((item) => item.quoteId === quote.quote_key.order_id);
    route.output.amount = '2000000';
    route.output.minAmountOut = '1980000';
    request.mockResolvedValue(response);
    await getQuote('socket', params, api);
    await expect(client.buildTx('socket', build)).rejects.toThrow('quoted amount changed');
  });

  test('Socket replaces backend quotes for provider-assisted routes', async () => {
    const { params, api } = direct('socket');
    const other = { bridge_id: 'oft', approve_contract_id: '' };
    api.getBridgeQuoteListV2.mockResolvedValue([
      { bridge_id: 'rfq-vault-executor', approve_contract_id: '', to_token_raw_amount: 1 }, other,
    ]);
    const quotes = await getQuote('socket', params, api);
    expect(quotes).toHaveLength(4);
    expect(quotes[0]).toBe(other);
    expect(quotes.filter((q) => q.bridge_id === 'rfq-vault-executor')).toHaveLength(1);
    expect(quotes.find((q) => q.bridge_id === 'rfq-vault-executor').to_token_raw_amount).toBeGreaterThan(1);
  });

  test('Socket provider failure retains other routes and removes unverified provider quotes', async () => {
    const { request, params, api } = direct('socket');
    request.mockRejectedValue(new Error('offline'));
    const other = { bridge_id: 'oft', approve_contract_id: '' };
    api.getBridgeQuoteListV2.mockResolvedValue([
      { bridge_id: 'rfq-vault-executor', approve_contract_id: '' }, other,
    ]);
    await expect(getQuote('socket', params, api)).resolves.toEqual([other]);
  });

  test('returned quote/transaction mutations cannot alter the private proof', async () => {
    const { client, params, api } = direct('relay');
    const [quote] = await getQuote('relay', params, api);
    const build = { ...params, bridgeId: quote.bridge_id, quoteKey: clone(quote.quote_key) };
    const tx = await buildTx('relay', build, api);
    quote.quote_key.order_id = '0x' + '00'.repeat(32);
    tx.data += '00';
    const original = await buildTx('relay', build, api);
    expect(client.verifyTx('relay', build, original).parsed.orderId).toBe(relay.expected.orderId);
  });

  test('clear invalidates a pending provider response', async () => {
    const response = deferred(), entered = deferred();
    const client = createBridgeProviderClient({ request: async () => { entered.resolve(); return response.promise; } });
    const result = client.getQuotes('socket', socket.params);
    await entered.promise;
    client.clear();
    response.resolve(clone(socket.response));
    await expect(result).rejects.toThrow(InvalidBridgeProviderError);
  });

  test('request timeout still rejects a stalled transport', async () => {
    const client = createBridgeProviderClient({ timeoutMs: 1, request: async () => new Promise(() => {}) });
    await expect(client.getQuotes('socket', socket.params)).rejects.toThrow('request timed out');
  });

  test('Fetch adapter uses raw JSON without cookies or redirects', async () => {
    const body = { ok: true };
    const fetch = jest.fn(async () => ({ ok: true, json: async () => body }));
    const request = createBridgeFetchRequest(fetch);
    const signal = new AbortController().signal;
    await expect(request({ url: 'https://api.relay.link/quote/v2', method: 'POST', body: { includeProtocolData: true },
      timeoutMs: 1000, signal })).resolves.toBe(body);
    expect(fetch).toHaveBeenCalledWith('https://api.relay.link/quote/v2', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"includeProtocolData":true}', signal, credentials: 'omit', redirect: 'error',
    });
  });
});

describe('LayerSwap provider order matching', () => {
  test.each([['pending', pending], ['completed', completed]])('checks the %s source transaction independent of execution state', async (_, fixture) => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2100, 0, 1));
    const { client, request, params, api } = layer(fixture);
    const tx = await buildTx('lifi', params, api);
    const checked = client.verifyTx('layerswap', params, tx);
    expect(checked.binding).toBe('provider-record');
    expect(checked.parsed.unresolvedFields).toEqual([]);
    for (const field of ['sourceAmount', 'bridgeAmount', 'minOutputAmount']) {
      expect(checked.parsed[field]).toBe(BigInt(fixture.expected[field]));
    }
    for (const field of ['sourceToken', 'outputToken', 'receiver']) expect(checked.parsed[field]).toBe(fixture.expected[field]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].url).toBe(`https://api.layerswap.io/api/v2/explorer/${fixture.tx.from}?page=1`);
  });

  test('expired provider status does not reject otherwise matching fields', async () => {
    const response = clone(pending.providerResponse);
    response.data[0].swap.status = 'expired';
    const { params, api } = layer(pending, response);
    await expect(buildTx('lifi', params, api)).resolves.toEqual(pending.tx);
  });

  test.each(['receiver', 'token', 'minimum', 'input', 'requestId', 'duplicate'])('rejects a mismatched %s', async (change) => {
    const response = clone(pending.providerResponse), row = response.data[0];
    if (change === 'receiver') row.swap.destination_address = attacker;
    if (change === 'token') row.swap.destination_token.contract = row.quote.destination_token.contract = attacker;
    if (change === 'minimum') row.quote.min_receive_amount = '0.00098666';
    if (change === 'input') row.swap.requested_amount = '0.001';
    if (change === 'requestId') row.swap.metadata.sequence_number++;
    if (change === 'duplicate') response.data.push(clone(row));
    const { params, api } = layer(pending, response);
    await expect(buildTx('lifi', params, api)).rejects.toThrow(InvalidBridgeProviderError);
  });

  test('rejects excess native value before querying the provider', async () => {
    const { params, api, request } = layer();
    api.buildBridgeTx.mockResolvedValue({ ...pending.tx, value: '1000000000000001' });
    await expect(buildTx('lifi', params, api)).rejects.toThrow('source value mismatch');
    expect(request).not.toHaveBeenCalled();
  });

  test('requires the selected output amount and a provider client', async () => {
    const { params, api, request } = layer();
    await expect(buildTx('lifi', { ...params, providerClient: undefined }, api)).rejects.toThrow(InvalidBridgeProviderError);
    await expect(buildTx('lifi', { ...params, toTokenRawAmount: undefined, quoteKey: {} }, api)).rejects.toThrow(InvalidBridgeProviderError);
    expect(request).not.toHaveBeenCalled();
  });

  test('matches the exact request ID on a later page', async () => {
    const { params, api, request } = layer();
    const other = clone(pending.providerResponse); other.data[0].swap.metadata.sequence_number--;
    request.mockResolvedValueOnce(other).mockResolvedValueOnce(clone(pending.providerResponse));
    await buildTx('lifi', params, api);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].url).toMatch(/\?page=2$/);
  });

  test('clear during a backend build prevents a stale provider lookup', async () => {
    const { client, params, api, request } = layer();
    const response = deferred();
    api.buildBridgeTx.mockReturnValue(response.promise);
    const result = buildTx('lifi', params, api);
    client.clear(); response.resolve(clone(pending.tx));
    await expect(result).rejects.toThrow('context changed');
    expect(request).not.toHaveBeenCalled();
  });
});
