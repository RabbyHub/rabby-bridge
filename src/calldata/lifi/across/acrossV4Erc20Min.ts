import { asBigint, asRecord, asString, decodeCall } from '../../abi.js';
import type { CalldataMethod } from '../../abi.js';
import { accountFromBytes32 } from '../../hex.js';
import { acrossPackedParam } from '../params.js';

export const startBridgeTokensViaAcrossV4ERC20Min: CalldataMethod = {
  name: 'startBridgeTokensViaAcrossV4ERC20Min',
  selector: '0x7260352d',
  decode(data) {
    const args = decodeCall(
      [
        acrossPackedParam,
        { name: 'sendingAssetId', kind: 'bytes', size: 32 },
        { name: 'inputAmount', kind: 'uint' },
      ],
      data
    );
    const parameters = asRecord(args.parameters);
    return {
      aggregatorId: 'lifi',
      method: 'startBridgeTokensViaAcrossV4ERC20Min',
      kind: 'bridge',
      sourceToken: accountFromBytes32(asString(args.sendingAssetId)),
      sourceAmount: asBigint(args.inputAmount),
      destinationChainId: asBigint(parameters.destinationChainId),
      receiver: accountFromBytes32(asString(parameters.receiver)),
      outputToken: accountFromBytes32(asString(parameters.receivingAssetId)),
      minOutputAmount: asBigint(parameters.outputAmount),
    };
  },
};
