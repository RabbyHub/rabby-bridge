import type { CalldataMethod } from '../../abi.js';
import { knownCompare } from '../../expect.js';
import { bridgeShape } from '../shape.js';
import { lifiBridgeMethod } from '../method.js';
import { applyLifiIntentData, lifiIntentDataParam } from '../params.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaLiFiIntentEscrowV2', '0x7dbcf1d9', [lifiIntentDataParam], false,
    (parsed, args) => applyLifiIntentData(parsed, args.lifiIntentData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaLiFiIntentEscrowV2', '0x6d21c5df', [lifiIntentDataParam], true,
    (parsed, args) => applyLifiIntentData(parsed, args.lifiIntentData)
  ),
];

export const compare = knownCompare;

export const check = bridgeShape;
