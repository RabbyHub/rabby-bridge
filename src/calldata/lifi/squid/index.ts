import type { CalldataMethod } from '../../abi.js';
import type { CompareMask } from '../../expect.js';
import type { ParsedBridgeCall } from '../../types.js';
import { bridgeShape } from '../shape.js';
import { applySquidData, squidDataParam } from '../params.js';
import { lifiBridgeMethod } from '../method.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaSquid', '0x3f313808', [squidDataParam], false,
    (parsed, args) => applySquidData(parsed, args.squidData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaSquid', '0xa8f66666', [squidDataParam], true,
    (parsed, args) => applySquidData(parsed, args.squidData)
  ),
];

export const compare = (parsed: ParsedBridgeCall): CompareMask => ({
  fromToken: parsed.sourceToken !== undefined,
  fromAmount: parsed.sourceAmount !== undefined,
  toToken: false,
  toAmount: false,
  receiver: true,
});

export const check = bridgeShape;
