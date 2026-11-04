import type { CalldataMethod } from '../../abi.js';
import { knownCompare } from '../../expect.js';
import { bridgeShape } from '../shape.js';
import { lifiBridgeMethod } from '../method.js';
import { applyLayerSwapData, layerSwapDataParam } from '../params.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaLayerSwap', '0xee9e98e0', [layerSwapDataParam], false,
    (parsed, args) => applyLayerSwapData(parsed, args.layerSwapData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaLayerSwap', '0x4c279d6b', [layerSwapDataParam], true,
    (parsed, args) => applyLayerSwapData(parsed, args.layerSwapData)
  ),
];

export const compare = knownCompare;

export const check = bridgeShape;
