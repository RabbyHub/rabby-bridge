import { sourceAmountMatches } from '../calldata/expect.js';
import type { BridgeErrorDefinition } from '../errors/index.js';
import { BRIDGE_ERRORS, BridgeError } from '../errors/index.js';
import { evmChainId } from '../calldata/chains.js';
import { txValue } from '../calldata/types.js';
import type { BridgeCalldataTx, ParsedBridgeCall } from '../calldata/types.js';
import type { BridgeQuoteListParams, BridgeTx } from '../quote.js';

export type JsonObject = Record<string, unknown>;
export const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError(BRIDGE_ERRORS.INVALID_OBJECT);
  return value as JsonObject;
};
export const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new BridgeError(BRIDGE_ERRORS.INVALID_ARRAY);
  return value;
};
export const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new BridgeError(BRIDGE_ERRORS.INVALID_STRING);
  return value;
};
export const address = (value: unknown): string => {
  const result = text(value).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(result)) throw new BridgeError(BRIDGE_ERRORS.INVALID_ADDRESS);
  return result;
};
export const bytes = (value: unknown, size?: number): string => {
  const result = text(value).toLowerCase();
  if (!/^0x([0-9a-f]{2})*$/.test(result) || (size !== undefined && result.length !== 2 + size * 2)) throw new BridgeError(BRIDGE_ERRORS.INVALID_BYTES);
  return result;
};
export const uint = (value: unknown, bits = 256): bigint => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new BridgeError(BRIDGE_ERRORS.UNSAFE_NUMBER);
  if (!['string', 'number', 'bigint'].includes(typeof value) || !/^(0x[0-9a-f]+|[0-9]+)$/i.test(String(value))) throw new BridgeError(BRIDGE_ERRORS.INVALID_AMOUNT);
  const n = BigInt(value as string | number | bigint);
  if (n < 0n || n >= 1n << BigInt(bits)) throw new BridgeError(BRIDGE_ERRORS.INVALID_AMOUNT);
  return n;
};
export const chain = (value: string): bigint => {
  const id = evmChainId(value);
  if (id === undefined || id > BigInt(Number.MAX_SAFE_INTEGER)) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_CHAIN);
  return id;
};
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const tokenAddress = (value: string, chainId: string): string => {
  if (value.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
      evmChainId(value) === chain(chainId)) return ZERO_ADDRESS;
  return address(value);
};

/** Include every user-controlled condition; never use backend quote fields as intent. */
export const intentKey = (params: BridgeQuoteListParams): string => JSON.stringify([
  address(params.userAddress), chain(params.fromChainId).toString(), tokenAddress(params.fromTokenId, params.fromChainId),
  uint(params.fromTokenRawAmount).toString(), chain(params.toChainId).toString(), tokenAddress(params.toTokenId, params.toChainId),
  slippageBps(params.slippage), params.feeRate ?? 0.25,
]);

export const slippageBps = (value: string | undefined): number => {
  if (!value || !/^(0|0?\.[0-9]{1,4})$/.test(value)) throw new BridgeError(BRIDGE_ERRORS.INVALID_SLIPPAGE_PRECISION);
  const n = Number(value) * 10000;
  if (!Number.isFinite(n) || n < 0 || n >= 10000) throw new BridgeError(BRIDGE_ERRORS.INVALID_SLIPPAGE);
  return Math.round(n);
};

export const assertIntent = (
  parsed: ParsedBridgeCall, params: BridgeQuoteListParams, expectedAmount: bigint, minimumQuantum = 1n
): void => {
  const errors: BridgeErrorDefinition[] = [];
  if (parsed.sourceToken !== tokenAddress(params.fromTokenId, params.fromChainId) &&
      tokenAddress(parsed.sourceToken ?? '', params.fromChainId) !== tokenAddress(params.fromTokenId, params.fromChainId)) errors.push(BRIDGE_ERRORS.FROM_TOKEN_MISMATCH);
  if (!sourceAmountMatches(parsed.sourceAmount, uint(params.fromTokenRawAmount)) || parsed.sourceAmount === 0n) errors.push(BRIDGE_ERRORS.FROM_AMOUNT_MISMATCH);
  if (parsed.destinationChainId !== chain(params.toChainId)) errors.push(BRIDGE_ERRORS.TO_CHAIN_MISMATCH);
  if (tokenAddress(parsed.outputToken ?? '', params.toChainId) !== tokenAddress(params.toTokenId, params.toChainId)) errors.push(BRIDGE_ERRORS.TO_TOKEN_MISMATCH);
  if (parsed.receiver !== address(params.userAddress)) errors.push(BRIDGE_ERRORS.RECEIVER_MISMATCH);
  // LayerSwap floors the minimum to its provider-declared token precision.
  if (minimumQuantum < 1n) throw new BridgeError(BRIDGE_ERRORS.INVALID_MINIMUM_PRECISION);
  const minimum = expectedAmount * BigInt(10000 - slippageBps(params.slippage)) / 10000n / minimumQuantum * minimumQuantum;
  if (expectedAmount <= 0n || minimum <= 0n || parsed.minOutputAmount === undefined || parsed.minOutputAmount < minimum) errors.push(BRIDGE_ERRORS.MIN_RECEIVE_MISMATCH);
  if (errors.length) throw new BridgeError(errors[0], { method: parsed.method }, errors);
};

/** Copy only signing fields; never carry arbitrary keys supplied by a service. */
export const transaction = (value: unknown, params: BridgeQuoteListParams): BridgeTx => {
  const raw = object(value);
  const chainId = uint(raw.chainId);
  if (chainId !== chain(params.fromChainId)) throw new BridgeError(BRIDGE_ERRORS.FROM_CHAIN_MISMATCH);
  const from = raw.from === undefined ? address(params.userAddress) : address(raw.from);
  if (from !== address(params.userAddress)) throw new BridgeError(BRIDGE_ERRORS.FROM_ADDRESS_MISMATCH);
  const result: Record<string, string | number> = {
    from, to: address(raw.to), data: bytes(raw.data), value: `0x${uint(raw.value ?? '0').toString(16)}`, chainId: Number(chainId),
  };
  for (const key of ['gas', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']) {
    if (raw[key] !== undefined) result[key] = `0x${uint(raw[key]).toString(16)}`;
  }
  return result as unknown as BridgeTx;
};

export const sameTransaction = (left: BridgeCalldataTx, right: BridgeCalldataTx): boolean => {
  return address(left.to) === address(right.to) && address(left.from) === address(right.from) &&
    uint(left.chainId) === uint(right.chainId) && bytes(left.data) === bytes(right.data) && txValue(left) === txValue(right);
};

export const feeDisplay = (raw: unknown, usd?: unknown) => ({
  raw_amount_hex_str: `0x${uint(raw ?? '0').toString(16)}`,
  usd_value: typeof usd === 'string' || typeof usd === 'number' ? Number(usd) || 0 : 0,
});
