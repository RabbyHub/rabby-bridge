import { BRIDGE_ERRORS, BridgeError } from '../../errors/index.js';
import { asBigint, asRecord, asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { subtractFees } from '../protocols.js';
import { bridgeData, fee, input } from './params.js';
import { readSocketBridge } from './protocols/index.js';

export const bridge: CalldataMethod = {
  name: 'bridge', selector: '0xb18248d5',
  decode(data) {
    const a = decodeCall([{ name: 'quoteId', kind: 'bytes', size: 32 }, input, fee, bridgeData,
      { name: 'bridgeCallData', kind: 'bytes' }], data);
    const source = asRecord(a.input);
    const hop = asRecord(a.bridgeData);
    const target = asString(hop.target);
    const token = asString(source.inputToken);
    const amount = subtractFees(asBigint(source.inputAmount), asBigint(asRecord(a.fee).amount));
    const protocol = readSocketBridge(asString(a.bridgeCallData), target, token, asBigint(hop.value), asString(hop.approvalSpender));
    if (['receiveERC20', 'depositForBurn'].includes(protocol?.protocolMethod ?? '') && protocol?.bridgeAmount !== amount) {
      throw new BridgeError(BRIDGE_ERRORS.SOCKET_DEPOSIT_AMOUNT_MISMATCH);
    }
    return {
      aggregatorId: 'socket', method: 'bridge', kind: 'bridge', quoteId: asString(a.quoteId),
      sourceToken: token, sourceAmount: asBigint(source.inputAmount), depositor: asString(source.user),
      bridgeToken: token, bridgeAmount: amount,
      referrer: asString(asRecord(a.fee).receiver), innerTarget: target,
      ...protocol,
    };
  },
};
