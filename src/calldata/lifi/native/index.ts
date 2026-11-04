import { BRIDGE_ERRORS, BridgeError } from '../../../errors/index.js';
import { asBigint, asRecord, asString, type AbiParam, type AbiValue } from '../../abi.js';
import { knownCompare } from '../../expect.js';
import { LAYERZERO_CHAINS, NATIVE_TOKEN, isNative } from '../../protocols.js';
import { lifiBridgeMethod } from '../method.js';
import { bridgeShape } from '../shape.js';
import type { ParsedBridgeCall } from '../../types.js';

const polygon = (parsed: ParsedBridgeCall) => {
  parsed.destinationChainId = 137n;
  parsed.minOutputAmount = parsed.bridgeAmount;
  if (isNative(parsed.bridgeToken as string)) {
    parsed.outputToken = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619';
  } else {
    parsed.outputTokenReference = { protocol: 'polygon', token: parsed.bridgeToken, destinationChainId: 137n };
  }
};

const gnosis = (parsed: ParsedBridgeCall) => {
  parsed.destinationChainId = 100n;
  parsed.minOutputAmount = parsed.bridgeAmount;
  if (['0x6b175474e89094c44da98b954eedeac495271d0f', '0xdc035d45d973e3ec169d2276ddab16f1e407384f'].includes(parsed.bridgeToken as string)) {
    parsed.outputToken = NATIVE_TOKEN;
  } else if (isNative(parsed.bridgeToken as string)) {
    parsed.outputToken = '0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1';
  } else {
    parsed.outputTokenReference = { protocol: 'gnosis', token: parsed.bridgeToken, destinationChainId: 100n };
  }
};

const megaETHData: AbiParam = { name: 'megaETHData', kind: 'tuple', components: [
  { name: 'assetIdOnL2', kind: 'address' }, { name: 'l2Gas', kind: 'uint' },
  { name: 'requiresDepositTo', kind: 'bool' },
] };

const megaETH = (parsed: ParsedBridgeCall, args: { [key: string]: AbiValue }) => {
  const data = asRecord(args.megaETHData);
  parsed.destinationChainId = 4326n;
  parsed.minOutputAmount = parsed.bridgeAmount;
  if (isNative(parsed.bridgeToken as string)) parsed.outputToken = NATIVE_TOKEN;
  else if (data.requiresDepositTo === false) {
    const token = asString(data.assetIdOnL2);
    if (isNative(token)) throw new BridgeError(BRIDGE_ERRORS.MISSING_MEGAETH_DESTINATION_TOKEN);
    parsed.outputToken = token;
  }
  // Custom depositTo bridges choose their remote token outside this calldata.
};

const supersetData: AbiParam = {
  name: 'supersetData', kind: 'tuple', components: [
    { name: 'path', kind: 'bytes' }, { name: 'amountOutMin', kind: 'uint' },
    { name: 'refundAddress', kind: 'address' }, { name: 'fallbackEoA', kind: 'address' },
    { name: 'deadline', kind: 'uint' }, { name: 'toEid', kind: 'uint' },
    { name: 'options', kind: 'bytes' }, { name: 'lzFee', kind: 'uint' },
  ],
};

const superset = (parsed: ParsedBridgeCall, args: { [key: string]: AbiValue }) => {
  const data = asRecord(args.supersetData);
  const path = asString(data.path).slice(2);
  if (path.length < 64 || (path.length - 64) % 70 !== 0) throw new BridgeError(BRIDGE_ERRORS.INVALID_SUPERSET_OMNI_TOKEN_PATH);
  parsed.minOutputAmount = asBigint(data.amountOutMin);
  parsed.destinationChainRef = `layerzero:${asBigint(data.toEid)}`;
  parsed.destinationChainId = LAYERZERO_CHAINS[asBigint(data.toEid).toString()];
  parsed.outputTokenReference = {
    protocol: 'superset', tokenId: `0x${path.slice(-64)}`,
    destinationChainId: parsed.destinationChainId, destinationChainRef: parsed.destinationChainRef,
  };
};

export const methods = [
  lifiBridgeMethod('startBridgeTokensViaPolygonBridge', '0xaf62c7d6', [], false, polygon),
  lifiBridgeMethod('swapAndStartBridgeTokensViaPolygonBridge', '0xb4f37581', [], true, polygon),
  lifiBridgeMethod('startBridgeTokensViaGnosisBridge', '0xf66fe519', [], false, gnosis),
  lifiBridgeMethod('swapAndStartBridgeTokensViaGnosisBridge', '0x7bf96e0a', [], true, gnosis),
  lifiBridgeMethod('startBridgeTokensViaMegaETHBridge', '0x4213dfff', [megaETHData], false, megaETH),
  lifiBridgeMethod('swapAndStartBridgeTokensViaMegaETHBridge', '0x22256e89', [megaETHData], true, megaETH),
  lifiBridgeMethod('startBridgeTokensViaSuperset', '0x0691ff78', [supersetData], false, superset),
  lifiBridgeMethod('swapAndStartBridgeTokensViaSuperset', '0xf26e657f', [supersetData], true, superset),
];

export const compare = knownCompare;
export const check = bridgeShape;
