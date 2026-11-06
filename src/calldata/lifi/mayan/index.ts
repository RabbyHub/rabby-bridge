import type { CalldataMethod } from '../../abi.js';
import { knownCompare } from '../../expect.js';
import { bridgeShape } from '../shape.js';
import { applyMayanData, mayanDataParam } from '../params.js';
import { lifiBridgeMethod } from '../method.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaMayan', '0xb4875292', [mayanDataParam], false,
    (parsed, args) => applyMayanData(parsed, args.mayanData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaMayan', '0x80c65808', [mayanDataParam], true,
    (parsed, args) => applyMayanData(parsed, args.mayanData)
  ),
];

export const compare = knownCompare;

export const check = bridgeShape;
