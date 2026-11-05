import { BRIDGE_ERRORS, BridgeError } from '../../errors/index.js';
import { innerCallDiagnostics } from '../diagnostics.js';
import {
  asArray,
  asBigint,
  asRecord,
  asString,
  type AbiParam,
  type AbiValue,
} from '../abi.js';
import { accountFromBytes32 } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';
import { readMayanProtocol } from '../mayan/readProtocol.js';
import { LAYERZERO_CHAINS, subtractFees } from '../protocols.js';
import { readLifiDestination } from './destination.js';

const swapComponents: AbiParam[] = [
  { name: 'callTo', kind: 'address' },
  { name: 'approveTo', kind: 'address' },
  { name: 'sendingAssetId', kind: 'address' },
  { name: 'receivingAssetId', kind: 'address' },
  { name: 'fromAmount', kind: 'uint' },
  { name: 'callData', kind: 'bytes' },
  { name: 'requiresDeposit', kind: 'bool' },
];

export const bridgeDataParam: AbiParam = {
  name: 'bridgeData',
  kind: 'tuple',
  components: [
    { name: 'transactionId', kind: 'bytes', size: 32 },
    { name: 'bridge', kind: 'string' },
    { name: 'integrator', kind: 'string' },
    { name: 'referrer', kind: 'address' },
    { name: 'sendingAssetId', kind: 'address' },
    { name: 'receiver', kind: 'address' },
    { name: 'minAmount', kind: 'uint' },
    { name: 'destinationChainId', kind: 'uint' },
    { name: 'hasSourceSwaps', kind: 'bool' },
    { name: 'hasDestinationCall', kind: 'bool' },
  ],
};

export const swapDataArrayParam: AbiParam = {
  name: 'swapData',
  kind: 'array',
  item: { name: 'swap', kind: 'tuple', components: swapComponents },
};

export const swapDataParam: AbiParam = {
  name: 'swapData',
  kind: 'tuple',
  components: swapComponents,
};

export const acrossDataParam: AbiParam = {
  name: 'acrossData',
  kind: 'tuple',
  components: [
    { name: 'receiverAddress', kind: 'bytes', size: 32 },
    { name: 'refundAddress', kind: 'bytes', size: 32 },
    { name: 'sendingAssetId', kind: 'bytes', size: 32 },
    { name: 'receivingAssetId', kind: 'bytes', size: 32 },
    { name: 'outputAmount', kind: 'uint' },
    { name: 'outputAmountMultiplier', kind: 'uint' },
    { name: 'exclusiveRelayer', kind: 'bytes', size: 32 },
    { name: 'quoteTimestamp', kind: 'uint' },
    { name: 'fillDeadline', kind: 'uint' },
    { name: 'exclusivityParameter', kind: 'uint' },
    { name: 'message', kind: 'bytes' },
  ],
};

export const stargateDataParam: AbiParam = {
  name: 'stargateData',
  kind: 'tuple',
  components: [
    { name: 'assetId', kind: 'uint' },
    {
      name: 'sendParams',
      kind: 'tuple',
      components: [
        { name: 'dstEid', kind: 'uint' },
        { name: 'to', kind: 'bytes', size: 32 },
        { name: 'amountLD', kind: 'uint' },
        { name: 'minAmountLD', kind: 'uint' },
        { name: 'extraOptions', kind: 'bytes' },
        { name: 'composeMsg', kind: 'bytes' },
        { name: 'oftCmd', kind: 'bytes' },
      ],
    },
    {
      name: 'fee',
      kind: 'tuple',
      components: [
        { name: 'nativeFee', kind: 'uint' },
        { name: 'lzTokenFee', kind: 'uint' },
      ],
    },
    { name: 'refundAddress', kind: 'address' },
  ],
};

export const relayDepositoryDataParam: AbiParam = {
  name: 'relayDepositoryData',
  kind: 'tuple',
  components: [
    { name: 'orderId', kind: 'bytes', size: 32 },
    { name: 'depositorAddress', kind: 'address' },
  ],
};

export const mayanDataParam: AbiParam = {
  name: 'mayanData',
  kind: 'tuple',
  components: [
    { name: 'nonEVMReceiver', kind: 'bytes', size: 32 },
    { name: 'mayanProtocol', kind: 'address' },
    { name: 'protocolData', kind: 'bytes' },
    { name: 'swapProtocol', kind: 'address' },
    { name: 'swapData', kind: 'bytes' },
    { name: 'middleToken', kind: 'address' },
    { name: 'minMiddleAmount', kind: 'uint' },
    { name: 'refundRecipient', kind: 'address' },
    { name: 'mayanAmountIn', kind: 'uint' },
  ],
};

export const gasZipDataParam: AbiParam = {
  name: 'gasZipData',
  kind: 'tuple',
  components: [
    { name: 'receiverAddress', kind: 'bytes', size: 32 },
    { name: 'destinationChains', kind: 'uint' },
  ],
};

export const squidDataParam: AbiParam = {
  name: 'squidData',
  kind: 'tuple',
  components: [
    { name: 'routeType', kind: 'uint' },
    { name: 'destinationChain', kind: 'string' },
    { name: 'destinationAddress', kind: 'string' },
    { name: 'bridgedTokenSymbol', kind: 'string' },
    { name: 'depositAssetId', kind: 'address' },
    {
      name: 'sourceCalls',
      kind: 'array',
      item: {
        name: 'call',
        kind: 'tuple',
        components: [
          { name: 'callType', kind: 'uint' },
          { name: 'target', kind: 'address' },
          { name: 'value', kind: 'uint' },
          { name: 'callData', kind: 'bytes' },
          { name: 'payload', kind: 'bytes' },
        ],
      },
    },
    { name: 'payload', kind: 'bytes' },
    { name: 'fee', kind: 'uint' },
    { name: 'enableExpress', kind: 'bool' },
  ],
};

export const acrossPackedParam: AbiParam = {
  name: 'parameters',
  kind: 'tuple',
  components: [
    { name: 'transactionId', kind: 'bytes', size: 8 },
    { name: 'receiver', kind: 'bytes', size: 32 },
    { name: 'depositor', kind: 'bytes', size: 32 },
    { name: 'destinationChainId', kind: 'uint' },
    { name: 'receivingAssetId', kind: 'bytes', size: 32 },
    { name: 'outputAmount', kind: 'uint' },
    { name: 'exclusiveRelayer', kind: 'bytes', size: 32 },
    { name: 'quoteTimestamp', kind: 'uint' },
    { name: 'fillDeadline', kind: 'uint' },
    { name: 'exclusivityParameter', kind: 'uint' },
    { name: 'message', kind: 'bytes' },
  ],
};

export const applyBridgeData = (method: string, raw: AbiValue): ParsedBridgeCall => {
  const data = asRecord(raw);
  return {
    aggregatorId: 'lifi',
    method,
    kind: 'bridge',
    sourceToken: asString(data.sendingAssetId),
    sourceAmount: asBigint(data.minAmount),
    bridgeToken: asString(data.sendingAssetId),
    bridgeAmount: asBigint(data.minAmount),
    destinationChainId: asBigint(data.destinationChainId),
    receiver: asString(data.receiver),
    bridgeReceiver: asString(data.receiver),
    referrer: asString(data.referrer),
  };
};

export const applyFirstSwap = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const swaps = asArray(raw);
  const deposits = swaps.map(asRecord).filter((swap) => swap.requiresDeposit === true);
  const first = deposits[0] ?? swaps[0];
  if (!first) {
    return;
  }
  const swap = asRecord(first);
  parsed.sourceToken = asString(swap.sendingAssetId);
  if (deposits.some((deposit) => asString(deposit.sendingAssetId) !== parsed.sourceToken)) {
    throw new BridgeError(BRIDGE_ERRORS.MULTIPLE_SOURCE_ASSETS_ARE_NOT_SUPPORTED);
  }
  parsed.sourceAmount = deposits.length
    ? deposits.reduce((sum, deposit) => sum + asBigint(deposit.fromAmount), 0n)
    : asBigint(swap.fromAmount);
};

export const applyAcrossData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const data = asRecord(raw);
  parsed.receiver = accountFromBytes32(asString(data.receiverAddress));
  parsed.outputToken = accountFromBytes32(asString(data.receivingAssetId));
  parsed.minOutputAmount = asBigint(data.outputAmount);
};

export const applyStargateData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const send = asRecord(asRecord(raw).sendParams);
  parsed.receiver = accountFromBytes32(asString(send.to));
  parsed.minOutputAmount = asBigint(send.minAmountLD);
};

export const applyRelayDepositoryData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  parsed.orderId = asString(asRecord(raw).orderId);
};

export const applyMayanData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const data = asRecord(raw);
  const receiver = accountFromBytes32(asString(data.nonEVMReceiver));
  if (!/^0x0*$/.test(receiver)) {
    parsed.receiver = receiver;
  }
  parsed.innerTarget = asString(data.mayanProtocol);
  parsed.diagnostics = innerCallDiagnostics(asString(data.protocolData), 'protocol');
  const protocol = readMayanProtocol(asString(data.protocolData),
    asBigint(data.minMiddleAmount) > 0n ? asBigint(data.minMiddleAmount) : parsed.bridgeAmount);
  if (!protocol) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_MAYAN_PROTOCOL_CALLDATA, parsed.diagnostics);
  const { sourceToken, sourceAmount, aggregatorId, method, kind, ...destination } = protocol;
  Object.assign(parsed, destination);
};

export const applyGasZipData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const data = asRecord(raw);
  parsed.receiver = accountFromBytes32(asString(data.receiverAddress));
  parsed.destinationChainRef = asBigint(data.destinationChains).toString();
};

export const applySquidData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const data = asRecord(raw);
  parsed.destinationChainRef = asString(data.destinationChain);
  parsed.receiver = asString(data.destinationAddress);
  parsed.sourceToken = asString(data.depositAssetId);
};

export const polymerDataParam: AbiParam = {
  name: 'polymerData',
  kind: 'tuple',
  components: [
    { name: 'polymerTokenFee', kind: 'uint' },
    { name: 'maxCCTPFee', kind: 'uint' },
    { name: 'nonEVMReceiver', kind: 'bytes', size: 32 },
    { name: 'solanaReceiverATA', kind: 'bytes', size: 32 },
    { name: 'minFinalityThreshold', kind: 'uint' },
    { name: 'refundRecipient', kind: 'address' },
    { name: 'hookData', kind: 'bytes' },
  ],
};

export const lifiIntentDataParam: AbiParam = {
  name: 'lifiIntentData',
  kind: 'tuple',
  components: [
    { name: 'dstCallReceiver', kind: 'bytes', size: 32 },
    { name: 'recipient', kind: 'bytes', size: 32 },
    { name: 'depositAndRefundAddress', kind: 'address' },
    { name: 'nonce', kind: 'uint' },
    { name: 'expires', kind: 'uint' },
    { name: 'fillDeadline', kind: 'uint' },
    { name: 'inputOracle', kind: 'address' },
    { name: 'outputOracle', kind: 'bytes', size: 32 },
    { name: 'outputSettler', kind: 'bytes', size: 32 },
    { name: 'outputToken', kind: 'bytes', size: 32 },
    { name: 'outputAmountMultiplier', kind: 'uint' },
    { name: 'dstCallSwapData', kind: 'array', item: swapDataParam },
    { name: 'outputContext', kind: 'bytes' },
  ],
};

export const layerSwapDataParam: AbiParam = {
  name: 'layerSwapData',
  kind: 'tuple',
  components: [
    { name: 'requestId', kind: 'bytes', size: 32 },
    { name: 'depositoryReceiver', kind: 'address' },
    { name: 'refundRecipient', kind: 'address' },
    { name: 'nonEVMReceiver', kind: 'bytes', size: 32 },
    { name: 'signature', kind: 'bytes' },
    { name: 'deadline', kind: 'uint' },
  ],
};

export const applyPolymerData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const data = asRecord(raw);
  parsed.outputTokenReference = { protocol: 'cctp', destinationChainId: parsed.destinationChainId };
  parsed.minOutputAmount = subtractFees(parsed.bridgeAmount ?? 0n, asBigint(data.polymerTokenFee), asBigint(data.maxCCTPFee));
  if (asString(data.hookData) !== '0x') {
    parsed.destinationCallData = asString(data.hookData);
    delete parsed.receiver;
    delete parsed.outputTokenReference;
    delete parsed.minOutputAmount;
  }
};

export const applyLifiIntentData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const data = asRecord(raw);
  parsed.receiver = accountFromBytes32(asString(data.recipient));
  parsed.outputToken = accountFromBytes32(asString(data.outputToken));
  parsed.minOutputAmount = (parsed.bridgeAmount ?? 0n) * asBigint(data.outputAmountMultiplier) / 10n ** 18n;
  if (asArray(data.dstCallSwapData).length) {
    const destination = readLifiDestination(parsed, data);
    parsed.hasDestinationCall = true;
    parsed.bridgeReceiver = accountFromBytes32(asString(data.dstCallReceiver));
    parsed.bridgeOutputToken = parsed.outputToken;
    parsed.bridgeOutputAmount = parsed.minOutputAmount;
    delete parsed.receiver;
    delete parsed.outputToken;
    delete parsed.minOutputAmount;
    // Unknown deployments and arbitrary calls remain unverified.
    if (destination) Object.assign(parsed, destination);
  }
  parsed.orderId = asBigint(data.nonce).toString(16).padStart(64, '0');
  parsed.orderId = `0x${parsed.orderId}`;
};

export const celerCircleDataParam: AbiParam = {
  name: 'celerCircleData',
  kind: 'tuple',
  components: [
    { name: 'maxFee', kind: 'uint' },
    { name: 'minFinalityThreshold', kind: 'uint' },
  ],
};

const paxosRouteParam: AbiParam = {
  name: 'route',
  kind: 'tuple',
  components: [
    { name: 'destEID', kind: 'uint' },
    { name: 'offerAsset', kind: 'address' },
    { name: 'wantAsset', kind: 'address' },
  ],
};

export const paxosDataParam: AbiParam = {
  name: 'paxosData',
  kind: 'tuple',
  components: [
    {
      name: 'quote',
      kind: 'tuple',
      components: [
        paxosRouteParam,
        { name: 'offerAmount', kind: 'uint' },
        { name: 'receiver', kind: 'address' },
        { name: 'protocolFee', kind: 'uint' },
        { name: 'integratorFee', kind: 'uint' },
        { name: 'integratorFeeReceiver', kind: 'address' },
        { name: 'distributorCode', kind: 'bytes', size: 32 },
        { name: 'deadline', kind: 'uint' },
        { name: 'salt', kind: 'bytes', size: 32 },
      ],
    },
    { name: 'signature', kind: 'bytes' },
    { name: 'nativeFee', kind: 'uint' },
    { name: 'refundRecipient', kind: 'address' },
  ],
};

export const applyPaxosData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const quote = asRecord(asRecord(raw).quote);
  const route = asRecord(quote.route);
  parsed.destinationChainRef = `layerzero:${asBigint(route.destEID)}`;
  parsed.destinationChainId = LAYERZERO_CHAINS[asBigint(route.destEID).toString()];
  parsed.outputToken = asString(route.wantAsset);
  const offerAmount = asBigint(quote.offerAmount);
  parsed.minOutputAmount = subtractFees(offerAmount, asBigint(quote.protocolFee), asBigint(quote.integratorFee));
  const receiver = asString(quote.receiver);
  parsed.receiver = receiver;
};

export const applyLayerSwapData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const data = asRecord(raw);
  if (asString(data.refundRecipient) !== parsed.receiver) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_REFUND_RECIPIENT_MISMATCH);
  if (!/^0x0*$/.test(asString(data.nonEVMReceiver))) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_LAYERSWAP_NON_EVM_RECEIVER);
  parsed.orderId = asString(data.requestId);
  // The LayerSwap signature binds bridgeData.receiver to this request ID.
};

export const applyCelerCircleData = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  parsed.outputTokenReference = { protocol: 'cctp', destinationChainId: parsed.destinationChainId };
  parsed.outputAmountReference = {
    kind: 'fees', amount: parsed.bridgeAmount ?? 0n,
    token: parsed.outputTokenReference, maxFee: asBigint(asRecord(raw).maxFee),
  };
};
