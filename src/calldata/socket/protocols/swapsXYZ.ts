import { BRIDGE_ERRORS, BridgeError } from '../../../errors/index.js';
import { asArray, asBigint, asRecord, asString, decodeCall, decodeParameters, type AbiParam } from '../../abi.js';
import { accountFromBytes32, readSelector } from '../../hex.js';
import type { ParsedBridgeCall } from '../../types.js';

const swap: AbiParam = { name: 'swap', kind: 'tuple', components: [
  { name: 'swapperId', kind: 'uint' }, { name: 'params', kind: 'tuple', components: [
    { name: 'amountIn', kind: 'uint' }, { name: 'amountOut', kind: 'uint' }, { name: 'dustOut', kind: 'uint' },
    { name: 'tokenIn', kind: 'address' }, { name: 'tokenOut', kind: 'address' }, { name: 'direction', kind: 'uint' },
    { name: 'refund', kind: 'address' }, { name: 'additionalArgs', kind: 'bytes' },
  ] },
] };
const instructions: AbiParam = { name: 'instructions', kind: 'tuple', components: [
  swap, { name: 'target', kind: 'address' }, { name: 'paymentOperator', kind: 'address' }, { name: 'refund', kind: 'address' },
  { name: 'executionFee', kind: 'uint' }, { name: 'payload', kind: 'bytes' }, { name: 'txId', kind: 'bytes', size: 32 },
] };
const fee: AbiParam = { name: 'fee', kind: 'tuple', components: [
  { name: 'appId', kind: 'bytes', size: 4 }, { name: 'affiliateId', kind: 'bytes', size: 4 },
  { name: 'bridgeFee', kind: 'uint' }, { name: 'deadline', kind: 'uint' }, { name: 'chainId', kind: 'uint' },
  { name: 'fees', kind: 'array', item: { name: 'fee', kind: 'tuple', components: [
    { name: 'recipient', kind: 'address' }, { name: 'token', kind: 'address' }, { name: 'amount', kind: 'uint' },
  ] } },
] };

export const readSwapsXYZ = (data: string): Partial<ParsedBridgeCall> => {
  const a = decodeCall([instructions, fee, { name: 'feeSignature', kind: 'bytes' },
    ...(readSelector(data) === '0x0c751e0b' ? [{ name: 'executionSignature', kind: 'bytes' as const }] : [])], data);
  const payload = asString(asRecord(a.instructions).payload);
  if (readSelector(payload) !== '0x24856bc3') throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_SWAPS_XYZ_EXECUTION);
  const commandData = decodeCall([{ name: 'commands', kind: 'bytes' },
    { name: 'inputs', kind: 'array', item: { name: 'input', kind: 'bytes' } }], payload);
  const commands = asString(commandData.commands).slice(2).match(/../g) ?? [];
  const inputs = asArray(commandData.inputs);
  if (commands.length !== inputs.length) throw new BridgeError(BRIDGE_ERRORS.HYPERLANE_COMMAND_LENGTH_MISMATCH);
  let result: Partial<ParsedBridgeCall> | undefined;
  for (let i = 0; i < commands.length; i += 1) {
    const command = Number.parseInt(commands[i], 16);
    if ([0, 1, 2, 3, 8].includes(command)) continue;
    if (![4, 5].includes(command) || result) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_HYPERLANE_OPERATION);
    const p = decodeParameters([
      { name: 'router', kind: 'address' }, { name: 'destination', kind: 'uint' }, { name: 'recipient', kind: 'bytes', size: 32 },
      { name: 'amount', kind: 'uint' }, ...(command === 5 ? [{ name: 'targetRouter', kind: 'bytes' as const, size: 32 }] : []),
      { name: 'value', kind: 'uint' }, { name: 'token', kind: 'address' }, { name: 'approval', kind: 'uint' },
    ], asString(inputs[i]));
    const domain = asBigint(p.destination);
    const ref = { protocol: 'hyperlane' as const, contract: asString(p.router), token: asString(p.token),
      destinationChainRef: `hyperlane:${domain}`,
      destinationChainId: [1n, 56n, 42161n, 8453n].includes(domain) ? domain : undefined,
      destinationContract: command === 5 ? accountFromBytes32(asString(p.targetRouter)) : undefined };
    const amount = asBigint(p.amount);
    if (amount === 1n << 255n) throw new BridgeError(BRIDGE_ERRORS.HYPERLANE_BALANCE_AMOUNT_REQUIRES_EXECUTION_STATE);
    result = { protocolMethod: `swaps-xyz/execute/${command === 5 ? 'transferRemoteTo' : 'transferRemote'}`,
      destinationChainId: ref.destinationChainId, destinationChainRef: ref.destinationChainRef,
      receiver: accountFromBytes32(asString(p.recipient)), outputTokenReference: ref,
      outputAmountReference: { kind: 'scale', amount, token: ref } };
  }
  if (!result) throw new BridgeError(BRIDGE_ERRORS.MISSING_HYPERLANE_TRANSFER);
  return result;
};
