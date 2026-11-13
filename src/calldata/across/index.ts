import type { CalldataMethod } from '../abi.js';
import { matchMethod } from '../match.js';
import type { BridgeCallExpectation } from '../expect.js';
import { finishCheck } from '../expect.js';
import type { BridgeCheck, DecodeHit } from '../types.js';
import { deposit } from './deposit.js';
import { depositNative } from './depositNative.js';
import { depositNow } from './depositNow.js';
import { depositV3 } from './depositV3.js';
import { depositV3Now } from './depositV3Now.js';
import { swapAndBridge } from './swapAndBridge.js';
import { acrossFailure } from './validate.js';

const METHODS: CalldataMethod[] = [
  depositV3,
  deposit,
  depositV3Now,
  depositNow,
  depositNative,
  swapAndBridge,
];

export const decodeAcross = (data: string, value: bigint): DecodeHit =>
  matchMethod(METHODS, data, value);

export const validateAcross = (
  data: string,
  value: bigint,
  expectation?: BridgeCallExpectation,
  chainId = ''
): BridgeCheck => {
  const hit = decodeAcross(data, value);
  if (!hit.ok) {
    return { ...hit, aggregatorId: 'across' };
  }
  return finishCheck('across', hit.parsed, acrossFailure(hit.parsed, chainId, expectation?.userAddress), expectation, chainId, {
    fromToken: true,
    fromAmount: true,
    toToken: true,
    toAmount: true,
    receiver: true,
  });
};
