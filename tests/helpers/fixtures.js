import { readFileSync } from 'node:fs';

const fixtureDir = new URL('../fixtures/', import.meta.url);
const readJson = (file) => JSON.parse(readFileSync(new URL(file, fixtureDir), 'utf8'));

export const manifest = readJson('onchain/manifest.json');
export const loadTransactions = (aggregatorId) => manifest.coverage
  .filter((entry) => !aggregatorId || entry.aggregatorId === aggregatorId)
  .flatMap((entry) => readJson(`onchain/${entry.file}`));

export const loadProviderHistoryTransactions = () => readJson('providers/history/cases.json');
export const loadProviderTransactions = () => {
  const relay = readJson('providers/relay/quote-v2.json');
  const socket = readJson('providers/socket/quote-v3.json');
  return [
    { id: 'relay-provider-v2', aggregatorId: 'relay', bridgeId: 'relay', chainKey: 'arb', toChainKey: 'base',
      tx: relay.tx, expected: relay.expected },
    ...socket.cases,
    ...['pending', 'completed'].map((status) => {
      const fixture = readJson(`providers/layerswap/${status}.json`);
      return { id: `layerswap-provider-${status}`, aggregatorId: 'lifi', bridgeId: 'layerswap', chainKey: 'eth', toChainKey: 'arb',
        tx: fixture.tx, expected: fixture.expected };
    }),
    ...loadProviderHistoryTransactions(),
  ];
};
export const loadQuoteTransactions = () => [
  ...readJson('quotes/cases.json'),
  ...readJson('quotes/routes/cases.json'),
];
export const loadBridgeCases = () => [...loadTransactions(), ...loadProviderTransactions(), ...loadQuoteTransactions()];
