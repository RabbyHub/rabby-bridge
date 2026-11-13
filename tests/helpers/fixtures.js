import { readFileSync } from 'node:fs';

const fixtureDir = new URL('../fixtures/', import.meta.url);
export const readFixture = (file) => JSON.parse(readFileSync(new URL(file, fixtureDir), 'utf8'));

export const fixtureIntent = (item) => ({
  userAddress: item.expected.receiver, fromTokenId: item.expected.sourceToken,
  fromTokenRawAmount: item.expected.sourceAmount, toChainId: item.toChainKey,
  toTokenId: item.expected.outputToken, toTokenRawAmount: item.expected.minOutputAmount, slippage: '0',
});

export const manifest = readFixture('onchain/manifest.json');
export const loadTransactions = (aggregatorId) => manifest.coverage
  .filter((entry) => !aggregatorId || entry.aggregatorId === aggregatorId)
  .flatMap((entry) => readFixture(`onchain/${entry.file}`));

export const loadProviderHistoryTransactions = () => readFixture('providers/history/cases.json');
export const loadProviderTransactions = () => {
  const relay = readFixture('providers/relay/quote-v2.json');
  const socket = readFixture('providers/socket/quote-v3.json');
  return [
    { id: 'relay-provider-v2', aggregatorId: 'relay', bridgeId: 'relay', chainKey: 'arb', toChainKey: 'base',
      tx: relay.tx, expected: relay.expected },
    ...socket.cases,
    ...['pending', 'completed'].map((status) => {
      const fixture = readFixture(`providers/layerswap/${status}.json`);
      return { id: `layerswap-provider-${status}`, aggregatorId: 'lifi', bridgeId: 'layerswap', chainKey: 'eth', toChainKey: 'arb',
        tx: fixture.tx, expected: fixture.expected };
    }),
    ...loadProviderHistoryTransactions(),
  ];
};
export const loadQuoteTransactions = () => [
  ...readFixture('quotes/cases.json'),
  ...readFixture('quotes/routes/cases.json'),
];
export const loadBridgeCases = () => [...loadTransactions(), ...loadProviderTransactions(), ...loadQuoteTransactions()];
