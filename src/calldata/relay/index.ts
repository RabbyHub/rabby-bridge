import type { CalldataMethod } from '../abi.js';
import { matchMethod } from '../match.js';
import type { BridgeCallExpectation, CompareMask } from '../expect.js';
import { finishCheck } from '../expect.js';
import type { BridgeCheck, DecodeHit, ParsedBridgeCall } from '../types.js';
import { depositErc20 } from './depositErc20.js';
import { depositErc20Allowance } from './depositErc20Allowance.js';
import { depositNative } from './depositNative.js';
import { multicall } from './multicall.js';
import { permit2TransferAndMulticall } from './permit2TransferAndMulticall.js';
import { permit3009TransferAndMulticall } from './permit3009TransferAndMulticall.js';
import { permit3009TransferAndMulticallSigned } from './permit3009TransferAndMulticallSigned.js';
import { permitTransferAndMulticall } from './permitTransferAndMulticall.js';
import { permitTransferAndMulticallLegacy } from './permitTransferAndMulticallLegacy.js';
import { transferAndMulticall } from './transferAndMulticall.js';
import { getBridgeRouter } from '../../list.js';
import { relayFailure } from './validate.js';
import { BRIDGE_ERRORS } from '../../errors/index.js';

const METHODS: CalldataMethod[] = [
  depositErc20,
  depositErc20Allowance,
  depositNative,
  multicall,
  transferAndMulticall,
  permit2TransferAndMulticall,
  permit3009TransferAndMulticall,
  permit3009TransferAndMulticallSigned,
  permitTransferAndMulticall,
  permitTransferAndMulticallLegacy,
];

export const decodeRelay = (data: string, value: bigint): DecodeHit =>
  matchMethod(METHODS, data, value);

const relayCompareMask = (parsed: ParsedBridgeCall): CompareMask => ({
  fromToken: parsed.sourceToken !== undefined,
  fromAmount: parsed.sourceAmount !== undefined && parsed.sourceToken !== undefined,
  toToken: false,
  toAmount: false,
  receiver: false,
});

export const validateRelay = (
  data: string,
  value: bigint,
  expectation?: BridgeCallExpectation,
  chainId = ''
): BridgeCheck => {
  const hit = decodeRelay(data, value);
  if (!hit.ok) {
    return { ...hit, aggregatorId: 'relay' };
  }
  return finishCheck(
    'relay',
    hit.parsed,
    hit.parsed.innerTarget && chainId && hit.parsed.innerTarget !== getBridgeRouter('relay', chainId)
      ? BRIDGE_ERRORS.RELAY_CANONICAL_DEPOSITORY_MISMATCH
      : expectation && hit.parsed.depositor !== undefined && hit.parsed.depositor !== expectation.userAddress.toLowerCase()
      ? BRIDGE_ERRORS.DEPOSITOR_MISMATCH : relayFailure(hit.parsed),
    expectation,
    chainId,
    relayCompareMask(hit.parsed)
  );
};
