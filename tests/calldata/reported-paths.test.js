import { word } from '../helpers/calldata.js';
import { readFixture } from '../helpers/fixtures.js';
import { describe, expect, test } from '@jest/globals';
import { decodeBridgeCalldata, validateBridgeTx } from '../../dist/index.js';
import { decodeParameters } from '../../dist/calldata/abi.js';
import { expectCalldataError } from '../helpers/assert-validation-error.js';

const records = readFixture('regressions/reported-paths.json');
const other = '0x2222222222222222222222222222222222222222';
const zero = '0x0000000000000000000000000000000000000000';
const expected = [
  { chain: 1n, input: '0xb88339cb7199b77e23db6e890353e22632ba630f', amount: '2099994989',
    token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', minimum: 2094745002n },
  { chain: 43114n, input: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', amount: '71567623',
    token: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7' },
  ...[3, 4].map(() => ({ chain: 57073n, input: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', amount: '25000000',
    token: '0x2d270e6886d130d724215a266106e6832161eaed', fixedReceiver: true })),
  { chain: 1n, input: '0xd56a6c45941ee8aae31ce6a30bd049e0f7489cbd', amount: '13000000000000000000000',
    token: '0xdac17f958d2ee523a2206206994597c13d831ec7', minimum: 194149n },
  { chain: 9745n, input: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amount: '150000000',
    token: '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb', minimum: 148245317n },
];
const decode = (record, data = record.tx.data) => decodeBridgeCalldata(record.aggregatorId, { ...record.tx, data });
const check = (record, data = record.tx.data) => {
  const e = expected[record.index - 1];
  return validateBridgeTx(record.aggregatorId, record.fromChain, record.bridgeId, { ...record.tx, data }, {
    userAddress: record.user, fromTokenId: e.input, fromTokenRawAmount: e.amount,
    toChainId: record.toChain, toTokenId: e.token, toTokenRawAmount: e.minimum?.toString(), slippage: 0,
  });
};
const replace = (data, before, after) => {
  expect(data).toContain(before);
  expect(after.length).toBe(before.length);
  return data.replace(before, after);
};
const setWord = (data, index, value) => data.slice(0, 10 + index * 64) + word(value) + data.slice(10 + (index + 1) * 64);
const calls = (record) => decodeParameters([{ name: 'instructions', kind: 'tuple', components: [
  { name: 'calls', kind: 'array', item: { name: 'call', kind: 'tuple', components: [
    { name: 'target', kind: 'address' }, { name: 'data', kind: 'bytes' }, { name: 'value', kind: 'uint' },
  ] } }, { name: 'fallback', kind: 'address' },
] }], decode(record).destinationCallData).instructions.calls;
const replaceCall = (record, index, mutate) => {
  const data = calls(record)[index].data;
  return replace(record.tx.data, data.slice(2), mutate(data).slice(2));
};
const rejectsReceiver = (record, data) => {
  expect(decode(record, data)?.receiver).toBeUndefined();
  expectCalldataError(() => check(record, data));
};

describe('reported bridge path regressions', () => {
  test.each(records)('resolves report #$index without a validation report', (record) => {
    const e = expected[record.index - 1];
    const parsed = decode(record);
    expect(parsed.destinationChainId).toBe(e.chain);
    expect(parsed.receiver).toBe(e.fixedReceiver ? undefined : record.user);
    expect(parsed.outputToken).toBe(record.index === 2 ? undefined : e.token);
    expect(parsed.minOutputAmount).toBe(e.minimum);
    if (e.fixedReceiver) expect(parsed.fixedReceiver).toBe(true);
    expect(check(record).errors).toEqual([]);
  });

  const eco = records[0];
  const messenger = '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d';
  const portal = '0xec000769a73b70e16f361a442292500b3bcf4a85';
  const burnStart = eco.tx.data.indexOf('8e0250ee');
  const burn = '0x' + eco.tx.data.slice(burnStart, burnStart + 8 + 7 * 64);
  const replaceBurn = (mutate) => replace(eco.tx.data, burn.slice(2), mutate(burn).slice(2));
  test.each([
    ['Portal', () => eco.tx.data.replaceAll(portal.slice(2), other.slice(2))],
    ['CCTP target and spender', () => eco.tx.data.replaceAll(messenger.slice(2), other.slice(2))],
    ['approval amount', () => replace(eco.tx.data, '095ea7b3' + word(messenger) + word(2094745002),
      '095ea7b3' + word(messenger) + word(2094745001))],
    ['burn amount', () => replaceBurn((data) => setWord(data, 0, 2094745001))],
    ['burn token', () => replaceBurn((data) => setWord(data, 3, other))],
    ['unknown domain', () => replaceBurn((data) => setWord(data, 1, 999))],
    ['nested call value', () => replace(eco.tx.data, word(messenger) + word(96) + word(0),
      word(messenger) + word(96) + word(1))],
  ])('Eco does not trust a substituted %s', (_, mutate) => rejectsReceiver(eco, mutate()));

  test('Eco compares the final CCTP receiver and chain, not the intermediate Eco chain', () => {
    expect(expectCalldataError(() => check(eco, replaceBurn((data) => setWord(data, 2, other)))).errors.map((e) => e.error_code))
      .toContain('BRIDGE_RECEIVER_MISMATCH');
    expect(expectCalldataError(() => check(eco, replaceBurn((data) => setWord(data, 1, 1)))).errors.map((e) => e.error_code))
      .toContain('BRIDGE_TO_CHAIN_MISMATCH');
  });

  const uniswap = records[1];
  const router = '0x661e93cca42afacb172121ef892830ca3b70f08d';
  const handler = '0x9610954acdca5ff7905f051a040ce33fe613c60e';
  const usdc = '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e';
  const usdt = expected[1].token;
  test.each([
    ['optional command', (data) => replace(data, word(1) + '10' + '0'.repeat(62), word(1) + '90' + '0'.repeat(62))],
    ['extra action', (data) => replace(data, '070b0e', '070b05')],
    ['partial input', (data) => replace(data, word(71513192), word(71513191))],
    ['zero minimum', (data) => replace(data, word(70859654), word(0))],
    ['payer', (data) => replace(data, word(usdc) + word(0) + word(0), word(usdc) + word(0) + word(1))],
    ['settlement token', (data) => replace(data, word(usdc) + word(0) + word(0), word(other) + word(0) + word(0))],
    ['take receiver', (data) => replace(data, word(usdt) + word(handler) + word(0), word(usdt) + word(other) + word(0))],
    ['take token', (data) => replace(data, word(usdt) + word(handler) + word(0), word(other) + word(handler) + word(0))],
    ['partial take', (data) => replace(data, word(usdt) + word(handler) + word(0), word(usdt) + word(handler) + word(1))],
    ['hook', (data) => replace(data, word(usdt) + word(14) + word(1) + word(zero), word(usdt) + word(14) + word(1) + word(other))],
  ])('Universal Router rejects a substituted %s', (_, mutate) => rejectsReceiver(uniswap, replaceCall(uniswap, 1, mutate)));

  test('Universal Router requires its reviewed deployment and matching prefunding', () => {
    rejectsReceiver(uniswap, uniswap.tx.data.replaceAll(router.slice(2), other.slice(2)));
    rejectsReceiver(uniswap, replaceCall(uniswap, 0, (data) => setWord(data, 0, other)));
  });

  test('Universal Router preserves the shared success/fallback receiver without claiming one output asset', () => {
    expect(decode(uniswap).unresolvedFields).toEqual(['outputToken', 'minOutputAmount']);
    const wrongPayout = replaceCall(uniswap, 3, (data) => setWord(data, 1, other));
    expectCalldataError(() => check(uniswap, wrongPayout));
  });

  const settler = records[4];
  test.each([
    ['deployment', (data) => data.replaceAll('addc26a3854feabfd20d6bf658254088d83a425a', other.slice(2))],
    ['action', (data) => replace(data, 'f61460f9', 'deadbeef')],
    ['partial balance ratio', (data) => data.replaceAll(word((1n << 256n) - 1n), word((1n << 256n) - 2n))],
    ['funding amount', (data) => replace(data, 'c1fb425e' + word('0xaddc26a3854feabfd20d6bf658254088d83a425a') +
      word(expected[5].input) + word((1n << 256n) - 1n),
    'c1fb425e' + word('0xaddc26a3854feabfd20d6bf658254088d83a425a') + word(expected[5].input) + word(1))],
    ['slippage receiver', (data) => replace(data, '1fff991f' + word('0x0f7ae28de1c8532170ad4ee566b5801485c13a0e'),
      '1fff991f' + word(other))],
    ['zero minimum', (data) => replace(data, word(194635), word(0))],
  ])('Ethereum Settler rejects a substituted %s', (_, mutate) => rejectsReceiver(settler, replaceCall(settler, 1, mutate)));

  test('Plasma still rejects unknown Handlers', () => {
    rejectsReceiver(records[5], records[5].tx.data.replaceAll('5e7840e06faccb6d1c3b5f5e0d1d3d07f2829bba', other.slice(2)));
  });

  test.each(records.slice(2, 4))('Ink report #$index still compares a non-allowlisted mint recipient', (record) => {
    const data = record.tx.data.replace('424a31a57f7c63918ecaa2fac38016a8af5a6ec2', other.slice(2));
    expect(expectCalldataError(() => check(record, data)).errors.map((e) => e.error_code)).toContain('BRIDGE_RECEIVER_MISMATCH');
  });
});
