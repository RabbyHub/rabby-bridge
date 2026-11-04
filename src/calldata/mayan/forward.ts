import type { AbiParam } from '../abi.js';
import type { ParsedBridgeCall } from '../types.js';
import { readMayanProtocol } from './readProtocol.js';

export const permitParams: AbiParam = {
  name: 'permitParams',
  kind: 'tuple',
  components: [
    { name: 'value', kind: 'uint' },
    { name: 'deadline', kind: 'uint' },
    { name: 'v', kind: 'uint' },
    { name: 'r', kind: 'bytes', size: 32 },
    { name: 's', kind: 'bytes', size: 32 },
  ],
};

export const finishForward = (
  method: string,
  protocol: string,
  protocolData: string,
  source: { token?: string; amount?: bigint; protocolAmount?: bigint }
): ParsedBridgeCall => {
  const parsed: ParsedBridgeCall = {
    aggregatorId: 'mayan',
    method,
    kind: 'bridge',
    innerTarget: protocol,
    sourceToken: source.token,
    sourceAmount: source.amount,
  };
  const order = readMayanProtocol(protocolData, source.protocolAmount ?? source.amount);
  if (!order) {
    return parsed;
  }
  const { sourceToken, sourceAmount, ...destination } = order;
  Object.assign(parsed, destination);
  parsed.sourceToken = parsed.sourceToken ?? order.sourceToken;
  if ((parsed.sourceAmount ?? 0n) === 0n) {
    parsed.sourceAmount = order.sourceAmount;
  }
  return parsed;
};
