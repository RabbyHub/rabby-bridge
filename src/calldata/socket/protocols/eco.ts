import { asArray, asBigint, asRecord, asString, decodeCall, decodeParameters, type AbiParam } from '../../abi.js';
import { destinationCall, readDestinationTransfers } from '../../destination.js';
import type { ParsedBridgeCall } from '../../types.js';
import { readSelector } from '../../hex.js';
import { CCTP_USDC } from '../../protocols.js';
import { SOCKET_CCTP_MESSENGER } from '../addresses.js';
import { readCctp } from './cctp.js';

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

export const readEco = (data: string, target: string, spender: string, value: bigint): Partial<ParsedBridgeCall> => {
  const a = decodeCall([{ name: 'destination', kind: 'uint' }, { name: 'route', kind: 'bytes' }, reward,
    { name: 'allowPartial', kind: 'bool' }], data);
  const r = asRecord(decodeParameters([route], asString(a.route)).route);
  const calls = asArray(r.calls).map(asRecord);
  const parsed: Partial<ParsedBridgeCall> = {
    protocolMethod: 'publishAndFund', destinationChainId: asBigint(a.destination),
    destinationCallData: asString(a.route), ...readDestinationTransfers(calls),
  };
  // shortcut: the reviewed HyperEVM Portal's approve + CCTP route; review other compositions before support.
  const portal = '0xec000769a73b70e16f361a442292500b3bcf4a85';
  const assets = asArray(r.tokens).map(asRecord);
  if (parsed.destinationChainId !== 999n || target !== portal || spender !== portal || value !== 0n ||
      asString(r.portal) !== portal || asBigint(r.nativeAmount) !== 0n || assets.length !== 1 || calls.length !== 2) return parsed;
  const [approval, burn] = calls;
  const token = CCTP_USDC['999'];
  const amount = asBigint(assets[0].amount);
  if (asString(assets[0].token) !== token || amount <= 0n || asString(approval.target) !== token ||
      asBigint(approval.value) !== 0n || readSelector(asString(approval.data)) !== '0x095ea7b3' ||
      asString(burn.target) !== SOCKET_CCTP_MESSENGER || asBigint(burn.value) !== 0n ||
      readSelector(asString(burn.data)) !== '0x8e0250ee') return parsed;
  const approved = decodeCall([{ name: 'spender', kind: 'address' }, { name: 'amount', kind: 'uint' }], asString(approval.data));
  const nested = readCctp(asString(burn.data));
  if (asString(approved.spender) !== SOCKET_CCTP_MESSENGER || asBigint(approved.amount) !== amount ||
      nested.bridgeToken !== token || nested.bridgeAmount !== amount || nested.fixedReceiver ||
      nested.destinationChainId === undefined || !nested.receiver || !nested.outputToken) return parsed;
  return { ...parsed, destinationChainId: nested.destinationChainId, destinationChainRef: nested.destinationChainRef,
    receiver: nested.receiver, outputToken: nested.outputToken, minOutputAmount: nested.minOutputAmount };
};
