import { BRIDGE_ERRORS, bridgeFailure } from '../errors/index.js';
import type { BridgeErrorDefinition } from '../errors/index.js';
import type { BridgeCheck, ParsedBridgeCall } from './types.js';
import { evmChainId } from './chains.js';

const NATIVE_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const RATIO_SCALE = 1_000_000n;

export type BridgeCallExpectation = {
  userAddress: string;
  fromTokenId: string;
  fromTokenRawAmount: string;
  toTokenId: string;
  /** 目标链 id。目标币是原生币时，用它识别 `hood` 这类链 id，而不是源链 id。 */
  toChainId?: string;
  toTokenRawAmount?: string;
  /** Selected backend quote key; only protocol identifiers with known semantics are compared. */
  quoteKey?: string | Record<string, unknown>;
  /** Relay `protocol.v2.orderData` captured with the transaction being signed. */
  orderData?: unknown;
  /** 小数滑点。0.01 表示 1%。 */
  slippage?: string | number;
};

export type CompareMask = {
  fromToken: boolean;
  fromAmount: boolean;
  toToken: boolean;
  toAmount: boolean;
  receiver: boolean;
};

export const knownCompare = (parsed: ParsedBridgeCall): CompareMask => ({
  fromToken: parsed.sourceToken !== undefined,
  fromAmount: parsed.sourceAmount !== undefined,
  toToken: parsed.outputToken !== undefined,
  toAmount: parsed.minOutputAmount !== undefined,
  receiver: parsed.receiver !== undefined,
});

const isHexAddress = (value: string) => /^0x[0-9a-f]{40}$/i.test(value);

const isNativeToken = (value: string, chainId: string) => {
  const normalized = value.toLowerCase();
  const network = evmChainId(normalized);
  return (
    normalized === NATIVE_ADDRESS ||
    normalized === ZERO_ADDRESS ||
    normalized === chainId.toLowerCase() ||
    (network !== undefined && network === evmChainId(chainId))
  );
};

const sameToken = (actual: string | undefined, expected: string, chainId: string) => {
  if (!actual) {
    return false;
  }
  if (isNativeToken(actual, chainId) && isNativeToken(expected, chainId)) {
    return true;
  }
  if (!isHexAddress(actual) || !isHexAddress(expected)) {
    return actual.toLowerCase() === expected.toLowerCase();
  }
  return actual.toLowerCase() === expected.toLowerCase();
};

const parseAmount = (amount: string): bigint | undefined => {
  try {
    return BigInt(amount);
  } catch {
    return undefined;
  }
};

const selectedQuoteIdentifier = (quoteKey: BridgeCallExpectation['quoteKey']): string | undefined => {
  let key = quoteKey;
  if (typeof key === 'string') {
    try { key = JSON.parse(key); }
    catch { return undefined; }
  }
  if (!key || typeof key !== 'object' || Array.isArray(key) || typeof key.quote_id !== 'string') return undefined;
  // Socket/Relay cache keys preserve the provider ID before a cache UUID suffix.
  const match = /^(0x[0-9a-f]{64})(?::[^:]+)?$/i.exec(key.quote_id);
  return match?.[1].toLowerCase();
};

/** Source payment is capped at 100.1% of local intent; smaller payments are allowed. */
export const sourceAmountMatches = (actual: bigint | undefined, expected: bigint): boolean =>
  actual !== undefined && actual >= 0n && expected >= 0n && actual * 1000n <= expected * 1001n;

/** Allow up to 5% below the slippage-adjusted minimum; higher guarantees always pass. */
const minReceiveMatches = (minReceive: bigint, quoted: bigint, slippage: number) => {
  if (minReceive <= 0n || quoted <= 0n || slippage < 0 || slippage >= 1) {
    return false;
  }
  const ratioScaled = BigInt(Math.round((1 - slippage) * Number(RATIO_SCALE)));
  const minimum = (quoted * ratioScaled) / RATIO_SCALE;
  if (minimum <= 0n) {
    return false;
  }
  return minReceive * 20n >= minimum * 19n;
};

export const expectationFailures = (
  parsed: ParsedBridgeCall,
  expectation: BridgeCallExpectation,
  chainId: string,
  mask: CompareMask
): BridgeErrorDefinition[] => {
  const reasons: BridgeErrorDefinition[] = [];
  const quoteIdentifier = selectedQuoteIdentifier(expectation.quoteKey);
  if (quoteIdentifier && parsed.aggregatorId === 'socket' && parsed.quoteId !== quoteIdentifier) {
    reasons.push(BRIDGE_ERRORS.QUOTE_ID_MISMATCH);
  }
  // Relay direct deposits sign an order hash, distinct from the cache key's requestId.
  if (quoteIdentifier && parsed.aggregatorId === 'relay' &&
      !['depositNative', 'depositErc20', 'depositErc20Allowance'].includes(parsed.method) &&
      parsed.requestId !== quoteIdentifier) {
    reasons.push(BRIDGE_ERRORS.REQUEST_ID_MISMATCH);
  }
  if (expectation.toChainId && parsed.destinationChainRef && parsed.destinationChainId === undefined) {
    reasons.push(BRIDGE_ERRORS.TO_CHAIN_MISMATCH);
  }
  if (expectation.toChainId && parsed.destinationChainId !== undefined) {
    const expectedChain = evmChainId(expectation.toChainId);
    if (expectedChain !== undefined && parsed.destinationChainId !== expectedChain) reasons.push(BRIDGE_ERRORS.TO_CHAIN_MISMATCH);
  }
  if (mask.fromToken && !sameToken(parsed.sourceToken, expectation.fromTokenId, chainId)) {
    reasons.push(BRIDGE_ERRORS.FROM_TOKEN_MISMATCH);
  }
  if (mask.fromAmount) {
    const expectedAmount = parseAmount(expectation.fromTokenRawAmount);
    if (expectedAmount === undefined || !sourceAmountMatches(parsed.sourceAmount, expectedAmount)) {
      reasons.push(BRIDGE_ERRORS.FROM_AMOUNT_MISMATCH);
    }
  }
  if (
    mask.toToken &&
    !sameToken(parsed.outputToken, expectation.toTokenId, expectation.toChainId || chainId)
  ) {
    reasons.push(BRIDGE_ERRORS.TO_TOKEN_MISMATCH);
  }
  if (mask.toAmount && expectation.toTokenRawAmount !== undefined) {
    const quoted = parseAmount(expectation.toTokenRawAmount);
    const slippage = Number(expectation.slippage);
    if (
      quoted === undefined ||
      parsed.minOutputAmount === undefined ||
      !Number.isFinite(slippage) ||
      !minReceiveMatches(parsed.minOutputAmount, quoted, slippage)
    ) {
      reasons.push(BRIDGE_ERRORS.MIN_RECEIVE_MISMATCH);
    }
  }
  if (mask.receiver && !parsed.fixedReceiver && !sameToken(parsed.receiver, expectation.userAddress, chainId)) {
    reasons.push(BRIDGE_ERRORS.RECEIVER_MISMATCH);
  }
  if (parsed.refundRecipients?.some((recipient) => recipient.toLowerCase() !== expectation.userAddress.toLowerCase())) {
    reasons.push(BRIDGE_ERRORS.REFUND_RECIPIENT_MISMATCH);
  }
  return reasons;
};

export const finishCheck = (
  aggregatorId: string,
  parsed: ParsedBridgeCall,
  structural: BridgeErrorDefinition | undefined,
  expectation: BridgeCallExpectation | undefined,
  chainId: string,
  mask: CompareMask
): BridgeCheck => {
  mask = {
    ...mask,
    fromToken: mask.fromToken && parsed.sourceToken !== undefined,
    fromAmount: mask.fromAmount && parsed.sourceAmount !== undefined,
    toToken: mask.toToken && parsed.outputToken !== undefined,
    toAmount: mask.toAmount && parsed.minOutputAmount !== undefined,
    receiver: mask.receiver && parsed.receiver !== undefined,
  };
  const expected = expectation
    ? expectationFailures(parsed, expectation, chainId, mask)
    : [];
  // A locally proven receiver is still useful when destination assets/amounts
  // cannot be reduced to one outcome. Unknown execution/receivers remain check failures.
  const unsupportedCall = (parsed.hasDestinationCall || parsed.destinationCallData !== undefined) &&
    parsed.receiver === undefined;
  const errors = [
    ...(structural ? [structural] : []),
    ...(unsupportedCall ? [BRIDGE_ERRORS.UNSUPPORTED_DESTINATION_CALL] : []),
    ...expected,
  ].map((error) => ({ ...error, ...parsed.diagnostics, aggregatorId, chainId, method: parsed.method,
    hasDestinationCall: Boolean(parsed.hasDestinationCall || parsed.destinationCallData !== undefined) }));
  const unverifiedFields = Object.entries({
    sourceToken: mask.fromToken, sourceAmount: mask.fromAmount, outputToken: mask.toToken,
    minOutputAmount: mask.toAmount && expectation?.toTokenRawAmount !== undefined,
    receiver: mask.receiver,
  }).filter(([, checked]) => !expectation || !checked).map(([field]) => field);
  if (expectation?.toChainId && parsed.destinationChainId === undefined) {
    unverifiedFields.push('destinationChainId');
  }
  if (errors.length) {
    return { ...bridgeFailure(errors), aggregatorId, method: parsed.method, parsed, unverifiedFields };
  }
  return { ok: true, aggregatorId, method: parsed.method, parsed, unverifiedFields, errors: [] };
};
