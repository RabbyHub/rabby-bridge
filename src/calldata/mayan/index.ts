import type { CalldataMethod } from '../abi.js';
import { matchMethod } from '../match.js';
import type { BridgeCallExpectation } from '../expect.js';
import { finishCheck, knownCompare } from '../expect.js';
import type { BridgeCheck, DecodeHit } from '../types.js';
import { forwardERC20 } from './forwardERC20.js';
import { forwardEth } from './forwardEth.js';
import { swapAndForwardERC20 } from './swapAndForwardERC20.js';
import { swapAndForwardEth } from './swapAndForwardEth.js';
import { mayanFailure } from './validate.js';

const METHODS: CalldataMethod[] = [
  forwardERC20,
  forwardEth,
  swapAndForwardERC20,
  swapAndForwardEth,
];

export const decodeMayan = (data: string, value: bigint): DecodeHit =>
  matchMethod(METHODS, data, value);

export const validateMayan = (
  data: string,
  value: bigint,
  expectation?: BridgeCallExpectation,
  chainId = ''
): BridgeCheck => {
  const hit = decodeMayan(data, value);
  if (!hit.ok) {
    return { ...hit, aggregatorId: 'mayan' };
  }
  return finishCheck(
    'mayan',
    hit.parsed,
    mayanFailure(hit.parsed),
    expectation,
    chainId,
    knownCompare(hit.parsed)
  );
};
