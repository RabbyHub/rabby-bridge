import type { CalldataMethod } from '../abi.js';
import { matchMethod } from '../match.js';
import type { BridgeCallExpectation } from '../expect.js';
import { finishCheck, knownCompare } from '../expect.js';
import type { BridgeCheck, DecodeHit } from '../types.js';
import { exec } from './exec.js';
import { socketFailure } from './validate.js';

const METHODS: CalldataMethod[] = [exec];

export const decodeSocket = (data: string, value: bigint): DecodeHit =>
  matchMethod(METHODS, data, value);

export const validateSocket = (
  data: string,
  value: bigint,
  expectation?: BridgeCallExpectation,
  chainId = ''
): BridgeCheck => {
  const hit = decodeSocket(data, value);
  if (!hit.ok) {
    return { ...hit, aggregatorId: 'socket' };
  }
  return finishCheck('socket', hit.parsed, socketFailure(hit.parsed, expectation?.userAddress), expectation, chainId, knownCompare(hit.parsed));
};
