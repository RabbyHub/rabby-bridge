import { BRIDGE_ERRORS, BridgeError } from '../errors/index.js';
export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';

export const WRAPPED_NATIVE_TOKENS: Record<string, string> = {
  1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  10: '0x4200000000000000000000000000000000000006',
  56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
  4663: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  8453: '0x4200000000000000000000000000000000000006',
  42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
  43114: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
  57073: '0x4200000000000000000000000000000000000006',
};

export const isNative = (token: string): boolean =>
  token === NATIVE_TOKEN || token.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// Circle CCTP domains and Wormhole IDs are different namespaces from EVM chain IDs.
export const CCTP_CHAINS: Record<string, bigint> = {
  0: 1n, 1: 43114n, 2: 10n, 3: 42161n, 6: 8453n, 7: 137n,
  10: 130n, 11: 59144n, 13: 146n, 15: 143n, 19: 999n,
};

export const WORMHOLE_CHAINS: Record<string, bigint> = {
  2: 1n, 4: 56n, 5: 137n, 6: 43114n, 23: 42161n, 24: 10n,
  30: 8453n, 38: 59144n, 44: 130n, 47: 999n, 48: 143n, 52: 146n,
};

// Mainnet endpoint IDs from LayerZero's network metadata; v1 and v2 IDs coexist.
export const LAYERZERO_CHAINS: Record<string, bigint> = {
  101: 1n, 30101: 1n, 102: 56n, 30102: 56n, 106: 43114n, 30106: 43114n,
  109: 137n, 30109: 137n, 110: 42161n, 30110: 42161n, 111: 10n, 30111: 10n,
  184: 8453n, 30184: 8453n, 183: 59144n, 30183: 59144n, 181: 5000n, 30181: 5000n,
  320: 130n, 30320: 130n, 332: 146n, 30332: 146n, 340: 1868n, 30340: 1868n,
  367: 999n, 30367: 999n, 370: 98866n, 30370: 98866n, 383: 9745n, 30383: 9745n,
  390: 143n, 30390: 143n, 416: 4663n, 30416: 4663n,
  255: 252n, 30255: 252n, 280: 1329n, 30280: 1329n,
};

export const CCIP_CHAINS: Record<string, bigint> = {
  '5009297550715157269': 1n, '15971525489660198786': 8453n, '11344663589394136015': 56n,
};

// Canonical Circle USDC, not a symbol-based or quote-provided token mapping.
export const CCTP_USDC: Record<string, string> = {
  1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  10: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
  137: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  42161: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  43114: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
  130: '0x078d782b760474a361dda0af3839290b0ef57ad6',
  143: '0x754704bc059f8c67012fed69bc8a327a5aafb603',
  146: '0x29219dd400f2bf60e5a23d13be72b486d4038894',
  999: '0xb88339cb7199b77e23db6e890353e22632ba630f',
  59144: '0x176211869ca2b568f2a7d4ee941e073a821ee1ff',
};

export const subtractFees = (amount: bigint, ...fees: bigint[]): bigint => {
  const total = fees.reduce((sum, fee) => sum + fee, 0n);
  if (total > amount) throw new BridgeError(BRIDGE_ERRORS.BRIDGE_FEES_EXCEED_THE_INPUT_AMOUNT);
  return amount - total;
};
