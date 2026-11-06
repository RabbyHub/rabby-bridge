import type { CalldataMethod } from '../../abi.js';
import type { CompareMask } from '../../expect.js';
import type { ParsedBridgeCall } from '../../types.js';
import { bridgeShape } from '../shape.js';
import { startBridgeTokensViaAcrossV4ERC20Min } from './acrossV4Erc20Min.js';
import { startBridgeTokensViaAcrossV4NativeMin } from './acrossV4NativeMin.js';
import { acrossDataParam, applyAcrossData } from '../params.js';
import { lifiBridgeMethod } from '../method.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaAcrossV4', '0xa1f1ce43', [acrossDataParam], false,
    (parsed, args) => applyAcrossData(parsed, args.acrossData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaAcrossV4', '0x1794958f', [acrossDataParam], true,
    (parsed, args) => applyAcrossData(parsed, args.acrossData)
  ),
  startBridgeTokensViaAcrossV4ERC20Min,
  startBridgeTokensViaAcrossV4NativeMin,
];

export const compare = (parsed: ParsedBridgeCall): CompareMask => ({
  fromToken: parsed.sourceToken !== undefined,
  fromAmount: parsed.sourceAmount !== undefined,
  toToken: true,
  toAmount: true,
  receiver: true,
});

export const check = bridgeShape;
