import { BRIDGE_ERRORS, BridgeError } from '../../../errors/index.js';
import { asRecord, asString, type AbiParam } from '../../abi.js';
import { accountFromBytes32 } from '../../hex.js';
import { knownCompare } from '../../expect.js';
import { lifiBridgeMethod } from '../method.js';
import { bridgeShape } from '../shape.js';

const allBridgeData: AbiParam = { name: 'allBridgeData', kind: 'tuple', components: [
  { name: 'recipient', kind: 'bytes', size: 32 }, { name: 'fees', kind: 'uint' },
  { name: 'receiveToken', kind: 'bytes', size: 32 }, { name: 'nonce', kind: 'uint' },
  { name: 'messenger', kind: 'uint' }, { name: 'payFeeWithSendingAsset', kind: 'bool' },
] };

const fill: Parameters<typeof lifiBridgeMethod>[4] = (parsed, args) => {
  const data = asRecord(args.allBridgeData);
  const receiver = accountFromBytes32(asString(data.recipient));
  if (receiver !== parsed.receiver) throw new BridgeError(BRIDGE_ERRORS.ALLBRIDGE_RECEIVER_MISMATCH);
  parsed.receiver = receiver;
  parsed.outputToken = accountFromBytes32(asString(data.receiveToken));
  // The destination pool prices vUSD when redeeming; there is no signed output minimum.
};

export const methods = [
  lifiBridgeMethod('startBridgeTokensViaAllBridge', '0x6a51e9a9', [allBridgeData], false, fill),
  lifiBridgeMethod('swapAndStartBridgeTokensViaAllBridge', '0x63267469', [allBridgeData], true, fill),
];
export const compare = knownCompare;
export const check = bridgeShape;
