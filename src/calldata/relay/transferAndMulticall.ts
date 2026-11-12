import { BRIDGE_ERRORS, BridgeError } from '../../errors/index.js';
import { asArray, asBigint, asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { callsParam, relayCall } from './calls.js';

export const transferAndMulticall: CalldataMethod = {
  name: 'transferAndMulticall',
  selector: '0xf9e4bab4',
  decode(data, value) {
    const args = decodeCall(
      [
        { name: 'tokens', kind: 'array', item: { name: 'token', kind: 'address' } },
        { name: 'amounts', kind: 'array', item: { name: 'amount', kind: 'uint' } },
        callsParam,
        { name: 'refundTo', kind: 'address' },
        { name: 'nftRecipient', kind: 'address' },
        { name: 'metadata', kind: 'bytes' },
      ],
      data
    );
    const tokens = asArray(args.tokens).map((token) => asString(token));
    const amounts = asArray(args.amounts).map((amount) => asBigint(amount));
    if (tokens.length !== amounts.length || new Set(tokens).size > 1) {
      throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_SOURCE_ASSET_LIST);
    }
    return relayCall('transferAndMulticall', asString(args.metadata), value, args.calls, {
      token: tokens[0],
      amount: amounts.reduce((sum, amount) => sum + amount, 0n),
    });
  },
};
