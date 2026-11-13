import { sourceAmountMatches } from '../../dist/calldata/expect.js';
import { BRIDGE_ERRORS, BridgeError } from '../../dist/errors/index.js';
import { evmChainId } from '../../dist/calldata/chains.js';
import { address, array, bytes, object, text, uint } from '../../dist/calldata/relay/orderData.js';
export { address, array, bytes, object, text, uint };

export const chain = (value) => {
  const id = evmChainId(value);
  if (id === undefined || id > BigInt(Number.MAX_SAFE_INTEGER)) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_CHAIN);
  return id;
};

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const tokenAddress = (value, chainId) => {
  if (value.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
      evmChainId(value) === chain(chainId)) return ZERO_ADDRESS;
  return address(value);
};

export const slippageBps = (value) => {
  if (!value || !/^(0|0?\.[0-9]{1,4})$/.test(value)) throw new BridgeError(BRIDGE_ERRORS.INVALID_SLIPPAGE_PRECISION);
  const n = Number(value) * 10000;
  if (!Number.isFinite(n) || n < 0 || n >= 10000) throw new BridgeError(BRIDGE_ERRORS.INVALID_SLIPPAGE);
  return Math.round(n);
};

export const assertIntent = (
  parsed, params, expectedAmount, minimumQuantum = 1n
) => {
  const errors = [];
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
  if (errors.length) throw new BridgeError(errors[0], { ...parsed.diagnostics, method: parsed.method }, errors);
};

/** Copy only signing fields; never carry arbitrary keys supplied by a service. */
export const transaction = (value, params) => {
  const raw = object(value);
  const chainId = uint(raw.chainId);
  if (chainId !== chain(params.fromChainId)) throw new BridgeError(BRIDGE_ERRORS.FROM_CHAIN_MISMATCH);
  const from = raw.from === undefined ? address(params.userAddress) : address(raw.from);
  if (from !== address(params.userAddress)) throw new BridgeError(BRIDGE_ERRORS.FROM_ADDRESS_MISMATCH);
  const result = {
    from, to: address(raw.to), data: bytes(raw.data), value: `0x${uint(raw.value ?? '0').toString(16)}`, chainId: Number(chainId),
  };
  for (const key of ['gas', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']) {
    if (raw[key] !== undefined) result[key] = `0x${uint(raw[key]).toString(16)}`;
  }
  return result;
};
