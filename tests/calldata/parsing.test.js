import { describe, expect, test } from '@jest/globals';
import { id } from '@ethersproject/hash';
import { decodeBridgeCalldata, validateBridgeCalldata, buildTx } from '../../dist/index.js';
import {
  loadProviderTransactions,
  loadQuoteTransactions,
  loadTransactions,
  fixtureIntent as intent,
} from '../helpers/fixtures.js';
import { word } from '../helpers/calldata.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

describe('complete onchain calldata test units', () => {
  const transactions = [...loadTransactions(), ...loadQuoteTransactions()].filter((item) => !item.expectedValidationError);
  const providers = loadProviderTransactions();
  const gapCases = transactions.filter((item) => item.regressionGroup === 'ten-missing-paths-20261103');
  const tags = { across: 'Across', lifi: 'LiFi', mayan: 'Mayan', relay: 'Relay', socket: 'Socket' };
  const find = (aggregator, bridge) => transactions.find((item) => item.aggregatorId === aggregator && item.bridgeId === bridge);
  const replaceWord = (data, offset, word) => data.slice(0, 2 + offset * 2) + word.replace(/^0x/, '').padStart(64, '0') + data.slice(2 + (offset + 32) * 2);
  const readWord = (data, offset) => Number(BigInt(`0x${data.slice(2 + offset * 2, 2 + (offset + 32) * 2)}`));

  test('[LiFi] decodes strings in runtimes without a global TextDecoder', () => {
    const item = transactions.find((entry) => entry.aggregatorId === 'lifi');
    const parsed = decodeBridgeCalldata('lifi', item.tx);
    const original = globalThis.TextDecoder;
    try {
      globalThis.TextDecoder = undefined;
      expect(decodeBridgeCalldata('lifi', item.tx)).toEqual(parsed);
    } finally {
      globalThis.TextDecoder = original;
    }
  });

  test.each([
    ['depositNow', 'bytes32', '0xea86bd46'],
    ['depositV3Now', 'address', '0x7aef642c'],
  ])('[Across] %s matches the deployed ABI selector and decodes its order', (method, addressType, selector) => {
    const signature = `${method}(${addressType},${addressType},${addressType},${addressType},uint256,uint256,uint256,${addressType},uint32,uint32,bytes)`;
    expect(id(signature).slice(0, 10)).toBe(selector);
    const user = '0x1111111111111111111111111111111111111111';
    const sourceToken = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const outputToken = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
    const words = [user, user, sourceToken, outputToken, 10000000, 9900000, 8453, 0, 1800, 0, 352, 0];
    const tx = { from: user, chainId: 1, value: '0x0',
      data: selector + words.map((value) => BigInt(value).toString(16).padStart(64, '0')).join('') };
    expect(decodeBridgeCalldata('across', tx)).toMatchObject({ method, sourceToken, outputToken,
      sourceAmount: 10000000n, minOutputAmount: 9900000n, destinationChainId: 8453n, receiver: user });
  });

  test('[Across] depositNative rejects excess value for an explicit input amount', () => {
    const item = transactions.find((entry) => entry.aggregatorId === 'across' && entry.tx.data.startsWith('0x609ea081') &&
      BigInt('0x' + entry.tx.data.slice(10 + 4 * 64, 10 + 5 * 64)) > 0n);
    expect(item).toBeDefined();
    expect(decodeBridgeCalldata('across', { ...item.tx, value: (BigInt(item.tx.value) + 1n).toString() })).toBeNull();
  });

  test('retains all ten previously omitted parser-gap samples', () => {
    expect(gapCases).toHaveLength(10);
  });

  test.each(gapCases.filter((item) => item.aggregatorId === 'across' && item.selector === '0x110560ad' && BigInt(item.tx.value) > 0n))(
    '[Across] $id distinguishes native input from wrapped ERC20 and rejects excess value', (item) => {
      expect(decodeBridgeCalldata('across', item.tx).sourceToken).toBe('0x0000000000000000000000000000000000000000');
      const excess = { ...item.tx, value: `0x${(BigInt(item.tx.value) + 1n).toString(16)}` };
      expect(decodeBridgeCalldata('across', excess)).toBeNull();
      expect(validateBridgeCalldata('across', item.chainKey, excess, intent(item)).ok).toBe(false);
      const erc20 = { ...item.tx, value: '0x0' };
      expect(decodeBridgeCalldata('across', erc20).sourceToken).not.toBe(item.expected.sourceToken);
      const check = validateBridgeCalldata('across', item.chainKey, erc20, intent(item));
      expect(check.ok).toBe(false);
      expect(check.reason).toContain('from_token');
    }
  );

  test('[Across] a known Handler address is only trusted on its configured destination chain', () => {
    const item = gapCases.find((item) => item.csvRow === 14);
    const oldHandler = 'a8ad2e87e2043711d8bec77e8bc3e2683c0ab6bd'.padStart(64, '0');
    const otherHandler = '5e7840e06faccb6d1c3b5f5e0d1d3d07f2829bba'.padStart(64, '0');
    const data = item.tx.data.replaceAll(oldHandler, otherHandler);
    const check = validateBridgeCalldata('across', item.chainKey, { ...item.tx, data }, intent(item));
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('unsupported destination call');
  });

  test('[Across] Avalanche rejects a foreign event emitter or a value-bearing telemetry call', () => {
    const item = transactions.find((item) => item.regressionGroup === 'completed-history-20261103' &&
      item.aggregatorId === 'across' && item.toChainKey === 'avax');
    const emitter = '25b15fc38d6a2c13feddd9cb51f184f7cf0d4c11'.padStart(64, '0');
    for (const replacement of ['bf75133b48b0a42ab9374027902e83c5e2949034', 'dead000000000000000000000000000000000000']) {
      const data = item.tx.data.replaceAll(emitter, replacement.padStart(64, '0'));
      expect(validateBridgeCalldata('across', item.chainKey, { ...item.tx, data }, intent(item)).ok).toBe(false);
    }
    const emitterWord = item.tx.data.indexOf(emitter);
    const valueOffset = (emitterWord - 2) / 2 + 64;
    const data = replaceWord(item.tx.data, valueOffset, '1');
    expect(validateBridgeCalldata('across', item.chainKey, { ...item.tx, data }, intent(item)).ok).toBe(false);
  });

  test('[Across] an arbitrary token with a withdraw selector is not treated as native currency', () => {
    const item = gapCases.find((item) => item.csvRow === 14);
    const wrapped = '0bd7d308f8e1639fab988df18a8011f41eacad73'.padStart(64, '0');
    const substituted = 'dead000000000000000000000000000000000000'.padStart(64, '0');
    const data = item.tx.data.replaceAll(wrapped, substituted);
    const check = validateBridgeCalldata('across', item.chainKey, { ...item.tx, data }, intent(item));
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('unsupported destination call');
  });

  test.each(transactions.map((item) => [tags[item.aggregatorId], item.id, item]))(
    '[%s] %s compares local fields and reports deferred output checks', async (tag, id, item) => {
      const check = validateBridgeCalldata(item.aggregatorId, item.chainKey, item.tx, intent(item));
      // These historical successes encode third-party retryable refund beneficiaries.
      const expectedErrors = [
        'coverage-socket-b69fe78f2aa0157f13085d0f17dc0bbad92407116f50d7a713aee8cefada1183',
        'coverage-socket-7519b6d151f1b8a42fc5e3dcbf03e782629731c71ce2ed7d174d157d6a4aaff3',
      ].includes(item.id) ? ['BRIDGE_REFUND_RECIPIENT_MISMATCH'] : [];
      expect(check.ok).toBe(expectedErrors.length === 0);
      expect(check.errors.map((error) => error.error_code)).toEqual(expectedErrors);
      expect(check.unverifiedFields).toEqual(check.parsed.unresolvedFields);
      const parsed = check.parsed;
      expect(parsed.sourceToken).toBe(item.expected.sourceToken);
      expect(parsed.sourceAmount).toBe(BigInt(item.expected.sourceAmount));
      if (parsed.outputToken === undefined) expect(parsed.unresolvedFields).toContain('outputToken');
      else expect(parsed.outputToken).toBe(item.expected.outputToken);
      if (parsed.minOutputAmount === undefined) expect(parsed.unresolvedFields).toContain('minOutputAmount');
      else expect(parsed.minOutputAmount).toBe(BigInt(item.expected.minOutputAmount));
      expect(parsed.receiver).toBe(item.expected.receiver);
      expect(parsed.destinationChainId).toBe(BigInt(item.expected.destinationChainId));
      expect(parsed.unresolvedFields.every((field) => ['outputToken', 'minOutputAmount'].includes(field))).toBe(true);
    }
  );

  test('[Relay] source-only decoding does not substitute the depositor for the final receiver', () => {
    const item = providers.find((item) => item.aggregatorId === 'relay');
    const parsed = decodeBridgeCalldata('relay', item.tx);
    expect(parsed.sourceToken).toBe(item.expected.sourceToken);
    expect(parsed.sourceAmount).toBe(BigInt(item.expected.sourceAmount));
    expect(parsed.receiver).toBeUndefined();
    expect(parsed.outputToken).toBeUndefined();
    expect(parsed.minOutputAmount).toBeUndefined();
  });

  test('[Across] rejects a substituted BSC inner SpokePool', () => {
    const item = transactions.find((item) => item.aggregatorId === 'across' && item.chainKey === 'bsc');
    const tuple = 4 + readWord(item.tx.data, 4);
    const data = replaceWord(item.tx.data, tuple + 10 * 32, 'dead000000000000000000000000000000000000');
    const check = validateBridgeCalldata('across', item.chainKey, { ...item.tx, data }, intent(item));
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('spoke pool is not in the allowlist');
  });

  test('[Socket] source-only RFQ decoding leaves delivery conditions unresolved', () => {
    const item = providers.find((item) => item.bridgeId === 'rfq-vault-executor');
    const parsed = decodeBridgeCalldata('socket', item.tx);
    expect(parsed.receiver).toBeUndefined();
    expect(parsed.outputToken).toBeUndefined();
    expect(parsed.minOutputAmount).toBeUndefined();
  });

  test.each(providers.filter((item) => ['cctp-v2', 'cctp-v2-slow'].includes(item.bridgeId)))(
    '[Socket] $bridgeId identifies USDC without substituting ClaimExecutor for the receiver', (item) => {
      const parsed = decodeBridgeCalldata('socket', item.tx);
      expect(parsed.outputToken).toBe(item.expected.outputToken);
      expect(parsed.receiver).toBeUndefined();
      expect(parsed.minOutputAmount).toBeUndefined();
      const check = validateBridgeCalldata('socket', item.chainKey, item.tx, {
        ...intent(item), toTokenId: '0xdead000000000000000000000000000000000000',
      });
      expect(check.ok).toBe(false);
      expect(check.reason).toContain('to_token');
    }
  );

  test.each(providers.filter((item) => item.bridgeId === 'layerswap'))(
    '[LiFi] $id preserves the LayerSwap receiver and rejects its replacement', (item) => {
      expect(decodeBridgeCalldata('lifi', item.tx).receiver).toBe(item.expected.receiver);
      const bridgeOffset = readWord(item.tx.data, 4);
      const data = replaceWord(item.tx.data, 4 + bridgeOffset + 5 * 32, 'dead000000000000000000000000000000000000');
      const check = validateBridgeCalldata('lifi', item.chainKey, { ...item.tx, data }, intent(item));
      expect(check.ok).toBe(false);
      expect(check.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ error_code: 'BRIDGE_LAYERSWAP_REFUND_RECIPIENT_MISMATCH' }),
      ]));
    }
  );

  test('[Socket] rejects a substituted allowance operator', () => {
    const item = find('socket', 'gnosis-native');
    const data = replaceWord(item.tx.data, 4, 'dead000000000000000000000000000000000000');
    expect(decodeBridgeCalldata('socket', { ...item.tx, data })).toBeNull();
  });

  test('[Socket] rejects a temporary allowance larger than the input', () => {
    const item = find('socket', 'gnosis-native');
    const data = replaceWord(item.tx.data, 68, (BigInt(item.expected.sourceAmount) + 1n).toString(16));
    expect(validateBridgeCalldata('socket', item.chainKey, { ...item.tx, data }).ok).toBe(false);
  });

  test('[Socket] rejects an unsupported destination call instead of skipping target comparisons', () => {
    const item = find('socket', 'ccip');
    const router = 4 + readWord(item.tx.data, 4 + 4 * 32) + 32;
    const bridge = router + 4 + readWord(item.tx.data, router + 4 + 17 * 32) + 32;
    const message = bridge + 4 + readWord(item.tx.data, bridge + 4 + 32);
    const receiver = message + readWord(item.tx.data, message) + 32;
    const payload = message + readWord(item.tx.data, message + 32);
    let data = replaceWord(item.tx.data, receiver, 'dead000000000000000000000000000000000000');
    // One payload byte overlaps a leading zero without changing the token array.
    data = replaceWord(data, payload, '1');
    const check = validateBridgeCalldata('socket', item.chainKey, { ...item.tx, data }, intent(item));
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('unsupported destination call');
  });

  test('[Relay] rejects a source transaction signed for another chain', () => {
    const item = providers.find((item) => item.aggregatorId === 'relay');
    const check = validateBridgeCalldata('relay', item.chainKey, { ...item.tx, chainId: 1 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('from_chain');
  });

  test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'not-a-value'])(
    '[Relay] rejects invalid transaction value without throwing: %s', (value) => {
      const item = providers.find((item) => item.aggregatorId === 'relay');
      const tx = { ...item.tx, value };
      expect(decodeBridgeCalldata('relay', tx)).toBeNull();
      expect(validateBridgeCalldata('relay', item.chainKey, tx)).toMatchObject({ ok: false, reason: 'invalid transaction value' });
    }
  );

  test('[Socket] rejects an amount splice that changes routing', () => {
    const item = find('socket', 'gnosis-native');
    const router = 4 + readWord(item.tx.data, 4 + 4 * 32) + 32;
    const offset = router + 4 + 32;
    const oldFlags = BigInt(`0x${item.tx.data.slice(2 + offset * 2, 2 + (offset + 32) * 2)}`);
    const flags = (oldFlags & ~(65535n << 16n)) | (36n << 16n);
    const data = replaceWord(item.tx.data, offset, flags.toString(16));
    expect(decodeBridgeCalldata('socket', { ...item.tx, data })).toBeNull();
  });

  test('[Socket] rejects a changed OFT final receiver', () => {
    const item = find('socket', 'oft');
    const router = 4 + readWord(item.tx.data, 4 + 4 * 32) + 32;
    const bridge = router + 4 + readWord(item.tx.data, router + 4 + 9 * 32) + 32;
    const send = bridge + 4 + readWord(item.tx.data, bridge + 4);
    const data = replaceWord(item.tx.data, send + 32, 'dead000000000000000000000000000000000000');
    const check = validateBridgeCalldata('socket', item.chainKey, { ...item.tx, data }, intent(item));
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('receiver');
  });
});

describe('deferred chain-state output fields', () => {
  const transactions = loadTransactions();
  const deferred = [
    ['lifi', 'superset', ['outputToken']],
    ['lifi', 'polygon', ['outputToken']],
    ['lifi', 'celercircle', ['minOutputAmount']],
    ['lifi', 'celercirclefast', ['minOutputAmount']],
    ['socket', 'ccip', ['outputToken', 'minOutputAmount']],
    ['socket', 'oft', ['outputToken', 'minOutputAmount']],
  ].map(([aggregator, bridge, fields]) => [aggregator, bridge, fields,
    transactions.find((item) => item.aggregatorId === aggregator && item.bridgeId === bridge)]);

  test.each(deferred)('[%s] %s reports unavailable output checks without resolving them', (aggregator, bridge, fields, item) => {
    const check = validateBridgeCalldata(aggregator, item.chainKey, item.tx, intent(item));
    expect(check.ok).toBe(true);
    expect(check.unverifiedFields).toEqual(fields);
    expect(check.parsed.unresolvedFields).toEqual(fields);
    for (const field of fields) expect(check.parsed[field]).toBeUndefined();
    expect(check.parsed.sourceToken).toBe(item.expected.sourceToken);
    expect(check.parsed.sourceAmount).toBe(BigInt(item.expected.sourceAmount));
    expect(check.parsed.receiver).toBe(item.expected.receiver);
  });

  test('[LiFi] still rejects a wrong locally mapped CCTP output token', () => {
    const item = transactions.find((item) => item.bridgeId === 'celercircle');
    const check = validateBridgeCalldata('lifi', item.chainKey, item.tx, {
      ...intent(item), toTokenId: '0xdead000000000000000000000000000000000000',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('to_token');
    expect(check.unverifiedFields).toEqual(['minOutputAmount']);
  });

  test('[Mayan] leaves an ERC20 order minimum unresolved instead of using the quote amount', () => {
    const item = transactions.find((item) => item.id === 'gap-mayan-9eb0918f56c5ea7e042a58124904ed542811727c9c58e0ee6606c156e914ba1f');
    const check = validateBridgeCalldata('mayan', item.chainKey, item.tx, { ...intent(item), toTokenRawAmount: '1' });
    expect(check.ok).toBe(true);
    expect(check.parsed.outputToken).toBe(item.expected.outputToken);
    expect(check.parsed.minOutputAmount).toBeUndefined();
    expect(check.unverifiedFields).toEqual(['minOutputAmount']);
  });

  test('[LiFi] accepts transaction input as calldata', () => {
    const item = transactions.find((item) => item.aggregatorId === 'lifi');
    const parsed = decodeBridgeCalldata('lifi', { ...item.tx, data: undefined, input: item.tx.data });
    expect(parsed).toEqual(decodeBridgeCalldata('lifi', item.tx));
  });
});

describe('reachable route modes beyond the historical function list', () => {
  const cases = loadQuoteTransactions().filter((item) => item.regressionGroup === 'route-reachability-20261104');
  const native = cases.find((item) => item.id === 'discovery-across-native-zero-fee');
  const input = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const output = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const user = native.tx.from;
  const direct = (selector, extra, sending = input, destination = 8453) => ({
    from: user, to: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', value: '0x0', chainId: 1,
    data: selector + [32 * (1 + extra.length), ...extra, 1, 320, 352, 0, sending, user,
      10000000, destination, 0, 0, 0, 0].map(word).join(''),
  });

  test.each(cases)('$id preserves captured provider quote bytes and checks the final transaction', async (item) => {
    for (const proof of item.providerQuote.proofs) {
      const body = readFileSync(new URL(`../fixtures/quotes/routes/${proof.file}`, import.meta.url));
      expect(createHash('sha256').update(body).digest('hex')).toBe(proof.sha256);
    }
    const check = validateBridgeCalldata(item.aggregatorId, item.chainKey, item.tx, {
      userAddress: item.request.userAddress, fromTokenId: item.request.fromTokenId,
      fromTokenRawAmount: item.request.fromTokenRawAmount, toChainId: item.request.toChainId,
      toTokenId: item.request.toTokenId, toTokenRawAmount: item.quoteBenchmark.quotedOutputAmount,
      slippage: item.request.slippage,
    });
    if (item.expectedUnresolvedFields) {
      expect(check.parsed.unresolvedFields).toEqual(item.expectedUnresolvedFields);
      expect(check.parsed.sourceToken).toBe(item.expected.sourceToken);
      expect(check.parsed.sourceAmount).toBe(BigInt(item.expected.sourceAmount));
      if (item.expectedReceiverVerified) expect(check.parsed.receiver).toBe(item.expected.receiver);
    } else {
      for (const f of ['sourceToken', 'receiver']) expect(check.parsed[f]).toBe(item.expected[f]);
      for (const f of ['sourceAmount', 'destinationChainId']) expect(check.parsed[f]).toBe(BigInt(item.expected[f]));
    }
    if (!item.expectedUnresolvedFields) {
      if (check.parsed.outputToken === undefined) expect(check.parsed.outputTokenReference).toBeDefined();
      else expect(check.parsed.outputToken).toBe(item.expected.outputToken);
      if (check.parsed.minOutputAmount === undefined) expect(check.parsed.outputAmountReference).toBeDefined();
      else expect(check.parsed.minOutputAmount).toBe(BigInt(item.expected.minOutputAmount));
    }
    const params = { ...item.request, bridgeId: item.bridgeId,
      toTokenRawAmount: item.quoteBenchmark.quotedOutputAmount };
    const api = { buildBridgeTx: async () => structuredClone(item.tx) };
    if (item.expectedValidationError) {
      expect(check.ok).toBe(false);
      expect(check.reason).toContain(item.expectedValidationError);
      const reports = [];
      await expect(buildTx(item.aggregatorId, { ...params, onError: (report) => reports.push(report) }, api))
        .rejects.toMatchObject({ error_code: check.error_code });
      expect(reports.flatMap((report) => report.errors)).toEqual(expect.arrayContaining([
        expect.objectContaining({ error_code: check.error_code, pass: false, blocking: true }),
      ]));
    } else {
      expect(check.ok).toBe(true);
      expect(check.unverifiedFields).toEqual(check.parsed.unresolvedFields);
      await expect(buildTx(item.aggregatorId, params, api)).resolves.toBeDefined();
    }
  });

  test('[Across] leaves native delivery unresolved without recipient code', () => {
    const parsed = decodeBridgeCalldata('across', native.tx);
    expect(parsed.outputToken).toBeUndefined();
    expect(parsed.outputTokenReference.protocol).toBe('across-native');
    expect(parsed.unresolvedFields).toEqual(['outputToken']);
  });

  test('[LiFi] M0 reads destination fields and rejects a different recipient', () => {
    const extra = [user, user, user, output, 0, 9900000, 2000000000];
    const parsed = decodeBridgeCalldata('lifi', direct('0x65782c4b', extra));
    expect(parsed.sourceToken).toBe(input);
    expect(parsed.sourceAmount).toBe(10000000n);
    expect(parsed.outputToken).toBe(output);
    expect(parsed.minOutputAmount).toBe(9900000n);
    expect(parsed.receiver).toBe(user);
    expect(parsed.unresolvedFields).toEqual([]);
    expect(decodeBridgeCalldata('lifi', direct('0x65782c4b', [1, ...extra.slice(1)]))).toBeNull();
    expect(decodeBridgeCalldata('lifi', direct('0x65782c4b', [user, 1, ...extra.slice(2)]))).toBeNull();
  });

  test('[LiFi] AllBridge and Garden leave uncommitted conditions unresolved', async () => {
    const allbridge = direct('0x6a51e9a9', [user, 100, output, 1, 1, true]);
    const garden = direct('0x5f9af35d', [1, user, 100, 1234, 0]);
    const a = decodeBridgeCalldata('lifi', allbridge), g = decodeBridgeCalldata('lifi', garden);
    expect(a.outputToken).toBe(output);
    expect(a.receiver).toBe(user);
    expect(a.minOutputAmount).toBeUndefined();
    expect(g.receiver).toBeUndefined();
    expect(g.destinationChainId).toBeUndefined();
    expect(g.outputToken).toBeUndefined();
    for (const [bridgeId, tx] of [['allbridge', allbridge], ['garden', garden]]) {
      const params = { userAddress: user, fromChainId: 'eth', toChainId: 'base', fromTokenId: input,
        fromTokenRawAmount: '10000000', toTokenId: output, toTokenRawAmount: '9900000', slippage: '0.01', bridgeId };
      const reports = [];
      const built = buildTx('lifi', { ...params, onError: (report) => reports.push(report) }, { buildBridgeTx: async () => tx });
      if (bridgeId === 'allbridge') {
        await expect(built).resolves.toBe(tx);
        expect(reports).toEqual([]);
      } else {
        await expect(built).rejects.toMatchObject({ errors: expect.arrayContaining([
          expect.objectContaining({ error_code: 'BRIDGE_UNVERIFIED_BRIDGE_FIELDS', toPass: false, blocking: true }),
        ]) });
        expect(reports).toHaveLength(1);
      }
    }
  });

  test('[LiFi] MegaETH custom depositTo ignores the unused assetIdOnL2', () => {
    const parsed = decodeBridgeCalldata('lifi', direct('0x4213dfff', [output, 200000, true], input, 4326));
    expect(parsed.outputToken).toBeUndefined();
    expect(parsed.unresolvedFields).toContain('outputToken');
  });
});
