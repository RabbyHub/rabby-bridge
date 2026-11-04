import { asArray, asBigint, asRecord, asString, decodeCall, decodeParameters, type AbiParam } from '../../abi.js';
import { destinationCall, readDestinationTransfers } from '../../destination.js';
import type { ParsedBridgeCall } from '../../types.js';

const tokens: AbiParam = { name: 'tokens', kind: 'array', item: { name: 'token', kind: 'tuple', components: [
  { name: 'token', kind: 'address' }, { name: 'amount', kind: 'uint' },
] } };
const reward: AbiParam = { name: 'reward', kind: 'tuple', components: [
  { name: 'deadline', kind: 'uint' }, { name: 'creator', kind: 'address' }, { name: 'prover', kind: 'address' },
  { name: 'nativeAmount', kind: 'uint' }, tokens,
] };
const route: AbiParam = { name: 'route', kind: 'tuple', components: [
  { name: 'salt', kind: 'bytes', size: 32 }, { name: 'deadline', kind: 'uint' }, { name: 'portal', kind: 'address' },
  { name: 'nativeAmount', kind: 'uint' }, tokens, { name: 'calls', kind: 'array', item: destinationCall },
] };

export const readEco = (data: string): Partial<ParsedBridgeCall> => {
  const a = decodeCall([{ name: 'destination', kind: 'uint' }, { name: 'route', kind: 'bytes' }, reward,
    { name: 'allowPartial', kind: 'bool' }], data);
  const r = asRecord(decodeParameters([route], asString(a.route)).route);
  return { protocolMethod: 'publishAndFund', destinationChainId: asBigint(a.destination),
    destinationCallData: asString(a.route), ...readDestinationTransfers(asArray(r.calls)) };
};
