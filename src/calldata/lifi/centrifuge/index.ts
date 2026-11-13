import { BRIDGE_ERRORS, BridgeError } from '../../../errors/index.js';
import { asRecord, asString, type AbiParam } from '../../abi.js';
import { knownCompare } from '../../expect.js';
import { lifiBridgeMethod } from '../method.js';
import { bridgeShape } from '../shape.js';

const centrifugeData: AbiParam = { name: 'centrifugeData', kind: 'tuple', components: [
  { name: 'nativeFee', kind: 'uint' }, { name: 'refundRecipient', kind: 'address' },
] };

const fill: Parameters<typeof lifiBridgeMethod>[4] = (parsed, args) => {
  if (asString(asRecord(args.centrifugeData).refundRecipient) !== parsed.receiver) {
    throw new BridgeError(BRIDGE_ERRORS.CENTRIFUGE_REFUND_RECIPIENT_MISMATCH);
  }
  parsed.minOutputAmount = parsed.bridgeAmount;
  parsed.outputTokenReference = { protocol: 'centrifuge', token: parsed.bridgeToken,
    destinationChainId: parsed.destinationChainId };
};

export const methods = [
  lifiBridgeMethod('startBridgeTokensViaCentrifuge', '0x0315138f', [centrifugeData], false, fill),
  lifiBridgeMethod('swapAndStartBridgeTokensViaCentrifuge', '0x8fd4d4dd', [centrifugeData], true, fill),
];
export const compare = knownCompare;
export const check = bridgeShape;
