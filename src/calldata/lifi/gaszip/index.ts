import type { CalldataMethod } from '../../abi.js';
import type { CompareMask } from '../../expect.js';
import type { ParsedBridgeCall } from '../../types.js';
import { bridgeShape } from '../shape.js';
import { applyGasZipData, gasZipDataParam } from '../params.js';
import { lifiBridgeMethod } from '../method.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaGasZip', '0xfc5f1003', [gasZipDataParam], false,
    (parsed, args) => applyGasZipData(parsed, args.gasZipData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaGasZip', '0x606326ff', [gasZipDataParam], true,
    (parsed, args) => applyGasZipData(parsed, args.gasZipData)
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
