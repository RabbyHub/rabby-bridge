import type { CalldataMethod } from '../../abi.js';
import type { CompareMask } from '../../expect.js';
import type { ParsedBridgeCall } from '../../types.js';
import { bridgeShape } from '../shape.js';
import { applyRelayDepositoryData, relayDepositoryDataParam } from '../params.js';
import { lifiBridgeMethod } from '../method.js';

export const methods: CalldataMethod[] = [
  lifiBridgeMethod(
    'startBridgeTokensViaRelayDepository', '0x092e8fa4', [relayDepositoryDataParam], false,
    (parsed, args) => applyRelayDepositoryData(parsed, args.relayDepositoryData)
  ),
  lifiBridgeMethod(
    'swapAndStartBridgeTokensViaRelayDepository', '0xa3443faa', [relayDepositoryDataParam], true,
    (parsed, args) => applyRelayDepositoryData(parsed, args.relayDepositoryData)
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
