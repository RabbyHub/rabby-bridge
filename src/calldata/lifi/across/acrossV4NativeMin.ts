import { asBigint, asRecord, asString, decodeCall } from '../../abi.js';
import type { CalldataMethod } from '../../abi.js';
import { accountFromBytes32 } from '../../hex.js';
import { acrossPackedParam } from '../params.js';

export const startBridgeTokensViaAcrossV4NativeMin: CalldataMethod = {
  name: 'startBridgeTokensViaAcrossV4NativeMin',
  selector: '0x72dd147e',
  decode(data, value) {
    const args = decodeCall([acrossPackedParam], data);
    const parameters = asRecord(args.parameters);
    return {
      aggregatorId: 'lifi',
      method: 'startBridgeTokensViaAcrossV4NativeMin',
      kind: 'bridge',
      sourceToken: '0x0000000000000000000000000000000000000000',
      sourceAmount: value,
      destinationChainId: asBigint(parameters.destinationChainId),
      receiver: accountFromBytes32(asString(parameters.receiver)),
      outputToken: accountFromBytes32(asString(parameters.receivingAssetId)),
      minOutputAmount: asBigint(parameters.outputAmount),
    };
  },
};
