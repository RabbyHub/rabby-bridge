import type { CalldataMethod } from '../../abi.js';
import { knownCompare } from '../../expect.js';
import { bridgeShape } from '../shape.js';
import { lifiBridgeMethod } from '../method.js';
import { applyPaxosData, paxosDataParam } from '../params.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaPaxosTransit', '0x5080ffe2', [paxosDataParam], false,
    (parsed, args) => applyPaxosData(parsed, args.paxosData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaPaxosTransit', '0x637f1d04', [paxosDataParam], true,
    (parsed, args) => applyPaxosData(parsed, args.paxosData)
  ),
];

export const compare = knownCompare;

export const check = bridgeShape;
