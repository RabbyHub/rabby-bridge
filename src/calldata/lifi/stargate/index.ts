import type { CalldataMethod } from '../../abi.js';
import type { CompareMask } from '../../expect.js';
import { bridgeShape } from '../shape.js';
import { applyStargateData, stargateDataParam } from '../params.js';
import { lifiBridgeMethod } from '../method.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaStargate', '0x14d53077', [stargateDataParam], false,
    (parsed, args) => applyStargateData(parsed, args.stargateData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaStargate', '0xa6010a66', [stargateDataParam], true,
    (parsed, args) => applyStargateData(parsed, args.stargateData)
  ),
];

export const compare = (): CompareMask => ({
  fromToken: true,
  fromAmount: true,
  toToken: false,
  toAmount: true,
  receiver: true,
});

export const check = bridgeShape;
