import { BRIDGE_ERRORS, BridgeError } from '../../errors/index.js';
import { asBigint, asRecord, asString, type AbiParam, type AbiValue } from '../abi.js';
import { isZeroWord } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';
import { NATIVE_TOKEN } from '../protocols.js';
import { nestedRelayOrder } from './nestedDeposit.js';

export const callTuple: AbiParam = {
  name: 'call',
  kind: 'tuple',
  components: [
    { name: 'target', kind: 'address' },
    { name: 'allowFailure', kind: 'bool' },
    { name: 'value', kind: 'uint' },
    { name: 'callData', kind: 'bytes' },
  ],
};

export const callsParam: AbiParam = {
  name: 'calls',
  kind: 'array',
  item: callTuple,
};

export const requestIdFromMetadata = (metadata: string): string | undefined => {
  const body = metadata.toLowerCase().replace(/^0x/, '');
  if (body.length < 64) {
    return undefined;
  }
  const requestId = `0x${body.slice(0, 64)}`;
  return isZeroWord(requestId) ? undefined : requestId;
};

export const relayCall = (
  method: string,
  metadata: string,
  value: bigint,
  calls: AbiValue,
  source?: { token?: string; amount?: bigint }
): ParsedBridgeCall => ({
  aggregatorId: 'relay',
  method,
  kind: 'deposit',
  requestId: requestIdFromMetadata(metadata),
  sourceToken: source?.token ?? (value > 0n ? NATIVE_TOKEN : undefined),
  sourceAmount: source?.amount && source.amount > 0n ? source.amount : value,
  ...nestedRelayOrder(calls,
    method === 'transferAndMulticall' && value === 0n && source?.token && source.amount !== undefined
      ? { token: source.token, amount: source.amount }
      : method === 'multicall' && value > 0n ? { token: NATIVE_TOKEN, amount: value } : undefined),
});

const amountOf = (record: { [key: string]: AbiValue }): bigint => {
  const amount = record.amount ?? record.value;
  return asBigint(amount);
};

export const firstPositive = (values: AbiValue[]): { token?: string; amount: bigint } => {
  let amount = 0n;
  let token: string | undefined;
  for (const value of values) {
    const record = asRecord(value);
    amount += amountOf(record);
    if (record.token) {
      const current = asString(record.token);
      if (token && token !== current) throw new BridgeError(BRIDGE_ERRORS.MULTIPLE_SOURCE_ASSETS_ARE_NOT_SUPPORTED);
      token = current;
    }
  }
  return { token, amount };
};

