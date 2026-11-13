import { asRecord, asString, type AbiParam } from '../../abi.js';
import { knownCompare } from '../../expect.js';
import { lifiBridgeMethod } from '../method.js';
import { bridgeShape } from '../shape.js';

const gardenData: AbiParam = { name: 'gardenData', kind: 'tuple', components: [
  { name: 'redeemer', kind: 'address' }, { name: 'refundAddress', kind: 'address' },
  { name: 'timelock', kind: 'uint' }, { name: 'secretHash', kind: 'bytes', size: 32 },
  { name: 'nonEvmReceiver', kind: 'bytes', size: 32 },
] };

const fill: Parameters<typeof lifiBridgeMethod>[4] = (parsed, args) => {
  parsed.requestId = asString(asRecord(args.gardenData).secretHash);
  // Garden locks only the source HTLC; BridgeData's destination fields are event metadata.
  delete parsed.receiver;
  delete parsed.destinationChainId;
  parsed.destinationChainRef = 'garden:offchain';
};

export const methods = [
  lifiBridgeMethod('startBridgeTokensViaGarden', '0x5f9af35d', [gardenData], false, fill),
  lifiBridgeMethod('swapAndStartBridgeTokensViaGarden', '0x76ad76fe', [gardenData], true, fill),
];
export const compare = knownCompare;
export const check = bridgeShape;
