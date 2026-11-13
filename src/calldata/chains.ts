import { CHAIN_ENUM_TO_SERVER_ID, normalizeChainEnum } from '../chains.js';

const CHAIN_IDS: Record<string, bigint> = {
  eth: 1n, op: 10n, flr: 14n, cro: 25n, rsk: 30n, xdc: 50n, bsc: 56n,
  xdai: 100n, fuse: 122n, uni: 130n, matic: 137n, monad: 143n, sonic: 146n,
  manta: 169n, xlayer: 196n, opbnb: 204n, lens: 232n, frax: 252n, era: 324n,
  stable: 988n, hyper: 999n, metis: 1088n, lisk: 1135n, sei: 1329n, story: 1514n,
  gravity: 1625n, soneium: 1868n, swell: 1923n, ron: 2020n, abs: 2741n,
  morph: 2818n, tempo: 4217n, megaeth: 4326n, hood: 4663n, world: 480n,
  mnt: 5000n, arc: 5042n, cyber: 7560n, klay: 8217n, base: 8453n, plasma: 9745n,
  ape: 33139n, mode: 34443n, arb: 42161n, celo: 42220n, hemi: 43111n, avax: 43114n,
  zircuit: 48900n, sophon: 50104n, ink: 57073n, linea: 59144n, bob: 60808n,
  bera: 80094n, blast: 81457n, plume: 98866n, taiko: 167000n, scrl: 534352n,
  katana: 747474n, zora: 7777777n,
  ethereum: 1n, optimism: 10n, gnosis: 100n, polygon: 137n, mantle: 5000n,
  arbitrum: 42161n, avalanche: 43114n, fraxtal: 252n,
};

export const evmChainId = (chain: string): bigint | undefined => {
  if (/^\d+$/.test(chain)) {
    const id = BigInt(chain);
    return id > 0n ? id : undefined;
  }
  const chainEnum = normalizeChainEnum(chain);
  return CHAIN_IDS[chainEnum ? CHAIN_ENUM_TO_SERVER_ID[chainEnum] : chain.toLowerCase()];
};

export const sourceChainMismatch = (
  expected: string, actual?: string | number | bigint
): boolean => {
  const expectedId = evmChainId(expected);
  if (actual === undefined || expectedId === undefined) return false;
  try {
    return (typeof actual === 'number' && !Number.isSafeInteger(actual)) ||
      BigInt(actual) !== expectedId;
  } catch {
    return true;
  }
};
