import { BRIDGE_AGGREGATORS } from '../consts.js';
import { SERVER_ID_TO_CHAIN_ENUM } from '../chains.js';
import { evmChainId } from '../calldata/chains.js';
import { BRIDGE_ERRORS } from './constants.js';
import type { BridgeErrorDefinition } from './constants.js';
import type { BridgeErrorDetail } from './index.js';

const definitions = new Map<string, BridgeErrorDefinition>(Object.values(BRIDGE_ERRORS).map((error) => [error.error_code, { ...error }]));
const chains = new Set(Object.entries(SERVER_ID_TO_CHAIN_ENUM).flatMap(([id, chain]) =>
  [id, chain, evmChainId(id)?.toString()].filter((value): value is string => typeof value === 'string')));
const bridges = new Set([
  ...BRIDGE_AGGREGATORS, 'celercircle', 'celercirclefast', 'gnosis', 'layerswap', 'lifiIntents',
  'mayanMCTP', 'paxos', 'polygon', 'polymer', 'polymerStandard', 'superset', 'FASTMCTP',
  'arbitrum-native', 'ccip', 'cctp-v2', 'cctp-v2-slow', 'eco', 'gnosis-native', 'native-op-stack',
  'oft', 'polygon-native', 'rfq-vault-executor', 'robinhood-native', 'swaps-xyz', 'megaeth',
  'centrifuge', 'frax', 'm0', 'allbridge', 'garden', 'gaszip', 'squid',
]);
const methods = new Set([
  'bridge', 'swapAndBridge', 'deposit', 'depositErc20', 'depositErc20Allowance', 'depositNative',
  'depositNow', 'depositV3', 'depositV3Now', 'exec', 'forwardERC20', 'forwardEth', 'multicall',
  'permit2TransferAndMulticall', 'permit3009TransferAndMulticall', 'permit3009TransferAndMulticallSigned',
  'permitTransferAndMulticall', 'permitTransferAndMulticallLegacy', 'transferAndMulticall',
  'swapAndForwardERC20', 'swapAndForwardEth', 'startBridgeTokensViaAcrossV4ERC20Min', 'startBridgeTokensViaAcrossV4NativeMin',
  ...['AcrossV4', 'AllBridge', 'CelerCircleBridge', 'Centrifuge', 'Frax', 'Garden', 'GasZip',
    'GnosisBridge', 'LayerSwap', 'LiFiIntentEscrowV2', 'M0', 'Mayan', 'MegaETHBridge', 'PaxosTransit',
    'PolygonBridge', 'PolymerCCTP', 'RelayDepository', 'Squid', 'Stargate', 'Superset']
    .flatMap((name) => [`startBridgeTokensVia${name}`, `swapAndStartBridgeTokensVia${name}`]),
  ...['Single', 'Multiple'].flatMap((kind) => ['ERC20ToERC20', 'ERC20ToNative', 'NativeToERC20']
    .map((assets) => `swapTokens${kind}V3${assets}`)),
]);
const fields = new Set(['sourceToken', 'sourceAmount', 'outputToken', 'minOutputAmount', 'receiver', 'destinationChainId']);
const selector = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{8}$/i.test(value);

/** A reporting allowlist, not an object spread: unknown labels and arbitrary properties never escape. */
export const sanitizeBridgeError = (value: unknown): BridgeErrorDetail => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const definition = typeof raw.error_code === 'string' ? definitions.get(raw.error_code) : undefined;
  const result: BridgeErrorDetail = { ...(definition ?? BRIDGE_ERRORS.UNKNOWN) };
  for (const [key, allowed] of [
    ['aggregatorId', new Set<string>(BRIDGE_AGGREGATORS)], ['provider', new Set(['relay', 'socket', 'layerswap', 'context'])],
    ['bridgeId', bridges], ['chainId', chains], ['toChainId', chains], ['method', methods],
    ['operation', new Set(['getQuote', 'buildTx', 'verifyTx', 'verifyLayerSwapTx'])],
    ['requestKind', new Set(['relay_chains', 'relay_quote', 'socket_quote', 'layerswap_orders', 'backend_quote', 'backend_build'])],
    ['calldataFormat', new Set(['missing', 'empty', 'valid', 'invalid'])],
  ] as const) {
    const item = raw[key];
    if (typeof item === 'string') {
      if (allowed.has(item)) Object.assign(result, { [key]: item });
      else if (['aggregatorId', 'provider', 'bridgeId', 'chainId', 'toChainId'].includes(key)) Object.assign(result, { [key]: 'unknown' });
    }
  }
  for (const key of ['selector', 'routerSelector', 'protocolSelector'] as const) {
    const item = raw[key];
    if (selector(item)) result[key] = item.toLowerCase();
  }
  for (const key of ['calldataBytes', 'routerCalldataBytes', 'protocolCalldataBytes', 'destinationCalldataBytes',
    'destinationCallCount', 'abiOffset', 'abiBufferBytes', 'commandCount'] as const) {
    const item = raw[key];
    if (typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 && item <= 10_000_000) result[key] = item;
  }
  if (typeof raw.commandByte === 'number' && Number.isInteger(raw.commandByte) && raw.commandByte >= 0 && raw.commandByte <= 255) result.commandByte = raw.commandByte;
  if (typeof raw.httpStatus === 'number' && Number.isInteger(raw.httpStatus) && raw.httpStatus >= 100 && raw.httpStatus <= 599) result.httpStatus = raw.httpStatus;
  for (const key of ['hasDestinationCall', 'blocking', 'pass', 'routerPass', 'fromPass', 'toPass', 'receiverPass'] as const) {
    const item = raw[key];
    if (typeof item === 'boolean') result[key] = item;
  }
  if (Array.isArray(raw.destinationSelectors)) result.destinationSelectors = [...new Set(raw.destinationSelectors.filter(selector).map((item) => item.toLowerCase()))].slice(0, 16);
  if (Array.isArray(raw.unverifiedFields)) result.unverifiedFields = [...new Set(raw.unverifiedFields.filter((item): item is string => typeof item === 'string' && fields.has(item)))];
  return result;
};
