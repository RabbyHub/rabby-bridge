import { BRIDGE_ERRORS, BridgeError, asBridgeError, bridgeFailure } from '../errors/index.js';
import type { BridgeErrorDetail } from '../errors/index.js';
import type { BridgeAggregatorId } from '../consts.js';
import { decodeAcross, validateAcross } from './across/index.js';
import { readSelector } from './hex.js';
import { decodeLifi, validateLifi } from './lifi/index.js';
import { decodeMayan, validateMayan } from './mayan/index.js';
import { decodeRelay, validateRelay } from './relay/index.js';
import { decodeSocket, validateSocket } from './socket/index.js';
import type { BridgeCallExpectation } from './expect.js';
import type { BridgeCalldataTx, BridgeCheck, DecodeHit, ParsedBridgeCall } from './types.js';
import { txCalldata, txValue } from './types.js';
import { sourceChainMismatch } from './chains.js';

const DECODERS: Partial<Record<BridgeAggregatorId, (data: string, value: bigint) => DecodeHit>> = {
  across: decodeAcross,
  lifi: decodeLifi,
  mayan: decodeMayan,
  relay: decodeRelay,
  socket: decodeSocket,
};

const VALIDATORS: Partial<
  Record<
    BridgeAggregatorId,
    (
      data: string,
      value: bigint,
      expectation?: BridgeCallExpectation,
      chainId?: string
    ) => BridgeCheck
  >
> = {
  across: validateAcross,
  lifi: validateLifi,
  mayan: validateMayan,
  relay: validateRelay,
  socket: validateSocket,
};

export const CALLDATA_AGGREGATORS = Object.keys(VALIDATORS) as BridgeAggregatorId[];

export class InvalidBridgeCalldataError extends BridgeError {
  constructor(
    public readonly aggregatorId: string,
    public readonly chainId: string,
    public readonly method: string | undefined,
    public readonly reason: string,
    errors?: BridgeErrorDetail[]
  ) {
    super(BRIDGE_ERRORS.INVALID_CALLDATA, { aggregatorId, chainId, method }, errors);
    this.message = `Invalid bridge calldata for ${aggregatorId} on ${chainId}: ${reason}`;
    this.name = 'InvalidBridgeCalldataError';
  }
}

export const hasBridgeCalldata = (tx: BridgeCalldataTx): boolean => {
  return readSelector(txCalldata(tx)) !== null;
};

/** Detailed decoding for callers that need failures instead of a nullable result. */
export const decodeBridgeCalldataResult = (aggregatorId: string, tx: BridgeCalldataTx): DecodeHit => {
  const context = { aggregatorId, selector: readSelector(txCalldata(tx)) ?? undefined };
  const decode = DECODERS[aggregatorId as BridgeAggregatorId];
  if (!decode) return bridgeFailure([{ ...BRIDGE_ERRORS.UNSUPPORTED_CALLDATA_AGGREGATOR, ...context }]);
  let value: bigint;
  try { value = txValue(tx); }
  catch (error) { return bridgeFailure(asBridgeError(error, BRIDGE_ERRORS.INVALID_TRANSACTION_VALUE, context).errors); }
  const hit = decode(txCalldata(tx), value);
  return hit.ok ? hit : { ...hit, errors: hit.errors.map((error) => ({ ...error, ...context })) };
};

export const decodeBridgeCalldata = (aggregatorId: string, tx: BridgeCalldataTx): ParsedBridgeCall | null => {
  const hit = decodeBridgeCalldataResult(aggregatorId, tx);
  return hit.ok ? hit.parsed : null;
};

export const validateBridgeCalldata = (
  aggregatorId: string,
  chainId: string,
  tx: BridgeCalldataTx,
  expectation?: BridgeCallExpectation
): BridgeCheck => {
  const context = { aggregatorId, chainId, selector: readSelector(txCalldata(tx)) ?? undefined };
  if (sourceChainMismatch(chainId, tx.chainId)) return { ...bridgeFailure([{ ...BRIDGE_ERRORS.FROM_CHAIN_MISMATCH, ...context }]), aggregatorId };
  if (expectation && tx.from !== undefined &&
      (typeof tx.from !== 'string' || tx.from.toLowerCase() !== expectation.userAddress.toLowerCase())) {
    return { ...bridgeFailure([{ ...BRIDGE_ERRORS.FROM_ADDRESS_MISMATCH, ...context }]), aggregatorId };
  }
  const validate = VALIDATORS[aggregatorId as BridgeAggregatorId];
  if (!validate) {
    return {
      ...bridgeFailure([{ ...BRIDGE_ERRORS.UNSUPPORTED_CALLDATA_AGGREGATOR, ...context }]),
      aggregatorId,
    };
  }
  let value: bigint;
  try { value = txValue(tx); }
  catch (error) { return { ...bridgeFailure(asBridgeError(error, BRIDGE_ERRORS.INVALID_TRANSACTION_VALUE, context).errors), aggregatorId }; }
  const check = validate(txCalldata(tx), value, expectation, chainId);
  return { ...check, errors: check.errors.map((error) => ({ ...error, ...context })) };
};

export type { BridgeCallExpectation } from './expect.js';

export type { BridgeCalldataTx, BridgeCheck, BridgeTokenReference, BridgeAmountReference, ParsedBridgeCall, DecodeHit } from './types.js';
