import type { CalldataMethod } from '../../abi.js';
import { knownCompare } from '../../expect.js';
import { bridgeShape } from '../shape.js';
import { lifiBridgeMethod } from '../method.js';
import { applyCelerCircleData, celerCircleDataParam } from '../params.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaCelerCircleBridge', '0xe0a4201c', [celerCircleDataParam], false,
    (parsed, args) => applyCelerCircleData(parsed, args.celerCircleData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaCelerCircleBridge', '0x4f3b0759', [celerCircleDataParam], true,
    (parsed, args) => applyCelerCircleData(parsed, args.celerCircleData)
  ),
];

export const compare = knownCompare;

export const check = bridgeShape;
