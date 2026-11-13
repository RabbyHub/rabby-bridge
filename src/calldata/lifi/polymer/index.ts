import type { CalldataMethod } from '../../abi.js';
import { knownCompare } from '../../expect.js';
import { bridgeShape } from '../shape.js';
import { lifiBridgeMethod } from '../method.js';
import { applyPolymerData, polymerDataParam } from '../params.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaPolymerCCTP', '0xf434d6ca', [polymerDataParam], false,
    (parsed, args) => applyPolymerData(parsed, args.polymerData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaPolymerCCTP', '0x17917a4e', [polymerDataParam], true,
    (parsed, args) => applyPolymerData(parsed, args.polymerData)
  ),
];

export const compare = knownCompare;

export const check = bridgeShape;
