import { readFileSync } from 'fs';

const fixtureDir = new URL('../fixtures/onchain-20261102/', import.meta.url);
const readJson = (file) => JSON.parse(readFileSync(new URL(file, fixtureDir), 'utf8'));

export const manifest = readJson('manifest.json');

export const loadTransactions = (aggregatorId) =>
  manifest.coverage
    .filter((entry) => !aggregatorId || entry.aggregatorId === aggregatorId)
    .flatMap((entry) => readJson(entry.file));

export const loadProviderHistoryTransactions = () => readJson('../providers/history-20261103/cases.json');

export const loadProviderTransactions = () => {
  const relay = readJson('../providers/relay-v2-20261103.json');
  const socket = readJson('../providers/socket-v3-20261103.json');
  return [
    { id: 'relay-provider-v2', aggregatorId: 'relay', bridgeId: 'relay', chainKey: 'arb', toChainKey: 'base',
      tx: relay.tx, expected: relay.expected },
    ...socket.cases,
    ...['pending', 'completed'].map((status) => {
      const fixture = readJson(`../providers/layerswap-${status}-20261103.json`);
      return { id: `layerswap-provider-${status}`, aggregatorId: 'lifi', bridgeId: 'layerswap', chainKey: 'eth', toChainKey: 'arb',
        tx: fixture.tx, expected: fixture.expected };
    }),
    ...loadProviderHistoryTransactions(),
  ];
};

export const loadQuoteTransactions = () => [
  ...readJson('../quotes-20261103/cases.json'),
  ...readJson('../route-discovery-20261104/cases.json'),
];

export const loadBridgeCases = () => [...loadTransactions(), ...loadProviderTransactions(), ...loadQuoteTransactions()];
