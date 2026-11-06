import { BRIDGE_ERRORS, BridgeError } from '../errors/index.js';
import { decodeCall, asRecord, asString } from '../calldata/abi.js';
import { decodeBridgeCalldataResult } from '../calldata/index.js';
import { bridgeDataParam, layerSwapDataParam, swapDataArrayParam } from '../calldata/lifi/params.js';
import type { BridgeBuildTxParams, BridgeTx } from '../quote.js';
import { address, array, bytes, chain, object, text, tokenAddress, transaction, uint, ZERO_ADDRESS } from './data.js';
import type { JsonObject } from './data.js';
import type { ProviderQuoteData } from './relay.js';

/** The API uses decimal quantities, sometimes in scientific notation. No float multiplication. */
const decimalAmount = (value: unknown, decimals: number): bigint => {
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new BridgeError(BRIDGE_ERRORS.UNSAFE_LAYERSWAP_AMOUNT);
  if (typeof value !== 'string' && typeof value !== 'number') throw new BridgeError(BRIDGE_ERRORS.MISSING_LAYERSWAP_AMOUNT);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new BridgeError(BRIDGE_ERRORS.INVALID_LAYERSWAP_AMOUNT);
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 255) throw new BridgeError(BRIDGE_ERRORS.INVALID_AMOUNT_EXPONENT);
  const scale = decimals + exponent - fraction.length;
  const digits = BigInt(match[1] + fraction);
  if (scale >= 0) return uint(digits * 10n ** BigInt(scale));
  const divisor = 10n ** BigInt(-scale);
  if (digits % divisor !== 0n) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_AMOUNT_EXCEEDS_TOKEN_PRECISION);
  return uint(digits / divisor);
};

const token = (raw: unknown, chainId: string) => {
  const t = object(raw);
  const decimals = Number(uint(t.decimals, 8));
  return { address: t.contract === null ? ZERO_ADDRESS : tokenAddress(text(t.contract), chainId), decimals,
    precision: t.precision === undefined ? decimals : Number(uint(t.precision, 8)) };
};

export const readLayerSwapDeposit = (tx: BridgeTx, params: BridgeBuildTxParams) => {
  if (params.bridgeId !== 'layerswap') throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_BRIDGE_ID_MISMATCH);
  const sourceTx = transaction(tx, params);
  const decodedResult = decodeBridgeCalldataResult('lifi', sourceTx);
  if (!decodedResult.ok) throw new BridgeError(BRIDGE_ERRORS.INVALID_CALLDATA, {}, decodedResult.errors);
  const parsed = decodedResult.parsed;
  if (!parsed || !parsed.method.endsWith('ViaLayerSwap') || !parsed.orderId || !parsed.receiver) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_LAYERSWAP_TRANSACTION);
  const args = decodeCall([bridgeDataParam,
    ...(parsed.method.startsWith('swapAnd') ? [swapDataArrayParam] : []), layerSwapDataParam], sourceTx.data);
  const layerData = asRecord(args.layerSwapData);
  if (asString(layerData.refundRecipient) !== address(params.userAddress)) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_REFUND_RECIPIENT_MISMATCH);
  if (uint(asString(layerData.nonEVMReceiver)) !== 0n) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_LAYERSWAP_NON_EVM_RECEIVER);
  const native = tokenAddress(parsed.sourceToken ?? '', params.fromChainId) === ZERO_ADDRESS;
  if (uint(sourceTx.value) !== (native ? parsed.sourceAmount : 0n)) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_SOURCE_VALUE_MISMATCH);
  return { tx: sourceTx, parsed };
};

export const layerSwapSequence = (row: unknown): bigint =>
  uint(object(object(object(row).swap).metadata).sequence_number);

export const readLayerSwapOrder = (
  raw: unknown, params: BridgeBuildTxParams, deposit: ReturnType<typeof readLayerSwapDeposit>
): ProviderQuoteData => {
  const row = object(raw), swap = object(row.swap), quote = object(row.quote);
  const { parsed, tx } = deposit;
  if (layerSwapSequence(row) !== uint(parsed.orderId)) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_REQUEST_ID_MISMATCH);
  if (typeof swap.id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(swap.id)) throw new BridgeError(BRIDGE_ERRORS.INVALID_LAYERSWAP_SWAP_ID);
  const assertNetworks = (data: JsonObject) => {
    if (object(data.source_network).type !== 'evm' || object(data.destination_network).type !== 'evm' ||
        uint(object(data.source_network).chain_id) !== chain(params.fromChainId) ||
        uint(object(data.destination_network).chain_id) !== chain(params.toChainId)) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_CHAIN_MISMATCH);
  };
  assertNetworks(swap);
  assertNetworks(quote);
  const source = token(swap.source_token, params.fromChainId), destination = token(swap.destination_token, params.toChainId);
  const quotedSource = token(quote.source_token, params.fromChainId), quotedDestination = token(quote.destination_token, params.toChainId);
  if (source.address !== quotedSource.address || source.decimals !== quotedSource.decimals ||
      destination.address !== quotedDestination.address || destination.decimals !== quotedDestination.decimals ||
      destination.precision !== quotedDestination.precision || destination.precision > destination.decimals) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_QUOTE_TOKEN_MISMATCH);
  if (source.address !== tokenAddress(parsed.bridgeToken ?? parsed.sourceToken ?? '', params.fromChainId) ||
      decimalAmount(swap.requested_amount, source.decimals) !== parsed.bridgeAmount ||
      decimalAmount(quote.requested_amount, source.decimals) !== parsed.bridgeAmount) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_BRIDGE_INPUT_MISMATCH);
  const receiver = address(swap.destination_address);
  if (receiver !== parsed.receiver || receiver !== address(params.userAddress)) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_RECEIVER_MISMATCH);
  const expectedAmount = decimalAmount(quote.receive_amount, destination.decimals);
  const minOutputAmount = decimalAmount(quote.min_receive_amount, destination.decimals);
  if (expectedAmount <= 0n || minOutputAmount <= 0n || minOutputAmount > expectedAmount) throw new BridgeError(BRIDGE_ERRORS.INVALID_LAYERSWAP_OUTPUT_AMOUNT);
  return { tx, parsed: { ...parsed, outputToken: destination.address, minOutputAmount, receiver, unresolvedFields: [] },
    expectedAmount,
    orderId: bytes(parsed.orderId, 32), requestId: bytes(parsed.orderId, 32), approveAddress: '',
    minimumQuantum: 10n ** BigInt(destination.decimals - destination.precision) };
};

export const layerSwapOrderRows = (raw: unknown): unknown[] => array(object(raw).data);
