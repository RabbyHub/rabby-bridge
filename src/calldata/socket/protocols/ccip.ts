import { BRIDGE_ERRORS, BridgeError } from '../../../errors/index.js';
import { asArray, asBigint, asRecord, asString, decodeCall, decodeParameters, type AbiParam } from '../../abi.js';
import { CCIP_CHAINS } from '../../protocols.js';
import type { ParsedBridgeCall } from '../../types.js';

const message: AbiParam = { name: 'message', kind: 'tuple', components: [
  { name: 'receiver', kind: 'bytes' }, { name: 'data', kind: 'bytes' },
  { name: 'tokenAmounts', kind: 'array', item: { name: 'tokenAmount', kind: 'tuple', components: [
    { name: 'token', kind: 'address' }, { name: 'amount', kind: 'uint' },
  ] } },
  { name: 'feeToken', kind: 'address' }, { name: 'extraArgs', kind: 'bytes' },
] };

export const readCcip = (data: string, target: string): Partial<ParsedBridgeCall> => {
  const a = decodeCall([{ name: 'destinationChainSelector', kind: 'uint' }, message], data);
  const m = asRecord(a.message);
  const amounts = asArray(m.tokenAmounts);
  if (amounts.length !== 1) throw new BridgeError(BRIDGE_ERRORS.CCIP_REQUIRES_ONE_BRIDGE_ASSET);
  const token = asRecord(amounts[0]);
  const ref = { protocol: 'ccip' as const, contract: target, token: asString(token.token),
    destinationChainId: CCIP_CHAINS[asBigint(a.destinationChainSelector).toString()],
    destinationChainRef: `ccip:${asBigint(a.destinationChainSelector)}` };
  const receiverData = asString(m.receiver);
  const receiver = receiverData.length === 66
    ? asString(decodeParameters([{ name: 'receiver', kind: 'address' }], receiverData).receiver) : undefined;
  const extra = asString(m.extraArgs);
  const direct = asString(m.data) === '0x' && (extra === '0x' || ['0x97a657c9', '0x181dcf10'].includes(extra.slice(0, 10)));
  return { protocolMethod: 'ccipSend', destinationChainId: ref.destinationChainId,
    destinationChainRef: ref.destinationChainRef, bridgeReceiver: receiver, receiver: direct ? receiver : undefined,
    outputTokenReference: direct ? ref : undefined,
    outputAmountReference: direct ? { kind: 'decimals', amount: asBigint(token.amount), token: ref } : undefined,
    destinationCallData: direct ? undefined : asString(m.data),
  };
};
