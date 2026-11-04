import { BRIDGE_ERRORS, BridgeError } from '../errors/index.js';
import { asArray, asBigint, asRecord, asString, decodeCall, decodeParameters, type AbiParam, type AbiValue } from './abi.js';
import { isZeroWord, readSelector } from './hex.js';
import { NATIVE_TOKEN, WRAPPED_NATIVE_TOKENS, subtractFees } from './protocols.js';
import type { ParsedBridgeCall } from './types.js';

export const destinationCall: AbiParam = {
  name: 'call', kind: 'tuple', components: [
    { name: 'target', kind: 'address' }, { name: 'data', kind: 'bytes' }, { name: 'value', kind: 'uint' },
  ],
};

export const readTransfer = (target: string, data: string, value: bigint): Partial<ParsedBridgeCall> | undefined => {
  if (data === '0x' && value > 0n) return { receiver: target, outputToken: NATIVE_TOKEN, minOutputAmount: value };
  if (readSelector(data) !== '0xa9059cbb') return undefined;
  const args = decodeCall([{ name: 'to', kind: 'address' }, { name: 'amount', kind: 'uint' }], data);
  return { receiver: asString(args.to), outputToken: target, minOutputAmount: asBigint(args.amount) };
};

export const readDestinationTransfers = (calls: AbiValue[]): Partial<ParsedBridgeCall> => {
  const transfers = calls.map((call) => {
    const c = asRecord(call);
    return readTransfer(asString(c.target), asString(c.data), asBigint(c.value));
  });
  if (!transfers.length || transfers.some((transfer) => !transfer)) return {};
  const first = transfers[0] as Partial<ParsedBridgeCall>;
  if (!transfers.every((transfer) => transfer !== undefined && transfer.receiver === first.receiver && transfer.outputToken === first.outputToken)) return {};
  return { ...first, minOutputAmount: transfers.reduce((sum, transfer) => sum + (transfer?.minOutputAmount ?? 0n), 0n) };
};

const instructions: AbiParam = {
  name: 'instructions', kind: 'tuple', components: [
    { name: 'calls', kind: 'array', item: { name: 'call', kind: 'tuple', components: [
      { name: 'target', kind: 'address' }, { name: 'callData', kind: 'bytes' }, { name: 'value', kind: 'uint' },
    ] } },
    { name: 'fallbackRecipient', kind: 'address' },
  ],
};

const ACROSS_MESSAGE_HANDLERS: Record<string, string> = {
  999: '0x5e7840e06faccb6d1c3b5f5e0d1d3d07f2829bba',
  4663: '0xa8ad2e87e2043711d8bec77e8bc3e2683c0ab6bd',
  43114: '0x9610954acdca5ff7905f051a040ce33fe613c60e',
};

export const applyAcrossMessage = (parsed: ParsedBridgeCall, message: string): ParsedBridgeCall => {
  if (message === '0x') {
    const wrapped = WRAPPED_NATIVE_TOKENS[parsed.destinationChainId?.toString() ?? ''];
    if (parsed.outputToken !== undefined && (wrapped === undefined || parsed.outputToken === wrapped)) {
      parsed.bridgeOutputToken = parsed.outputToken;
      parsed.outputTokenReference = { protocol: 'across-native', token: parsed.outputToken,
        destinationChainId: parsed.destinationChainId, destinationContract: parsed.receiver };
      delete parsed.outputToken;
    }
    return parsed;
  }
  const handler = parsed.receiver;
  parsed.bridgeReceiver = handler;
  parsed.bridgeOutputToken = parsed.outputToken;
  parsed.bridgeOutputAmount = parsed.minOutputAmount;
  parsed.destinationCallData = message;
  delete parsed.receiver;
  delete parsed.outputToken;
  delete parsed.minOutputAmount;
  // Other message handlers can implement arbitrary destination logic.
  const expectedHandler = ACROSS_MESSAGE_HANDLERS[parsed.destinationChainId?.toString() ?? ''] ??
    '0x0f7ae28de1c8532170ad4ee566b5801485c13a0e';
  if (handler !== expectedHandler) return parsed;
  const emitter = parsed.destinationChainId === 43114n
    ? '0x25b15fc38d6a2c13feddd9cb51f184f7cf0d4c11' : '0xbf75133b48b0a42ab9374027902e83c5e2949034';
  const args = asRecord(decodeParameters([instructions], message).instructions);
  const balances = new Map<string, bigint>([[parsed.bridgeOutputToken as string, parsed.bridgeOutputAmount as bigint]]);
  const payouts: Partial<ParsedBridgeCall>[] = [];
  for (const raw of asArray(args.calls)) {
    const call = asRecord(raw);
    const target = asString(call.target);
    const data = asString(call.callData);
    const value = asBigint(call.value);
    const selector = readSelector(data);
    // emitData is telemetry; its amounts are not an enforced receive floor.
    if (selector === '0xd836083e' && target === emitter && value === 0n) continue;
    if (selector === '0xc41e8295' && target === handler) {
      if (value !== 0n) return parsed;
      const nested = decodeCall([
        { name: 'target', kind: 'address' }, { name: 'data', kind: 'bytes' }, { name: 'value', kind: 'uint' },
        { name: 'replacements', kind: 'array', item: { name: 'replacement', kind: 'tuple', components: [
          { name: 'token', kind: 'address' }, { name: 'offset', kind: 'uint' },
        ] } },
      ], data);
      const token = asString(nested.target);
      const replacements = asArray(nested.replacements).map(asRecord);
      const withdrawal = asString(nested.data);
      if (readSelector(withdrawal) !== '0x2e1a7d4d' || replacements.length !== 1 ||
          asBigint(decodeCall([{ name: 'amount', kind: 'uint' }], withdrawal).amount) !== 0n ||
          asBigint(nested.value) !== 0n ||
          asString(replacements[0].token) !== token || asBigint(replacements[0].offset) !== 4n || !balances.has(token) ||
          WRAPPED_NATIVE_TOKENS[parsed.destinationChainId?.toString() ?? ''] !== token) return parsed;
      balances.set(NATIVE_TOKEN, (balances.get(NATIVE_TOKEN) ?? 0n) + (balances.get(token) ?? 0n));
      balances.set(token, 0n);
      continue;
    }
    if (selector === '0xef8738d3' && target === handler) {
      if (value !== 0n) return parsed;
      const drain = decodeCall([{ name: 'token', kind: 'address' }, { name: 'receiver', kind: 'address' }], data);
      const token = asString(drain.token);
      const amount = balances.get(token) ?? 0n;
      if (amount > 0n) payouts.push({ outputToken: token, minOutputAmount: amount, receiver: asString(drain.receiver) });
      balances.set(token, 0n);
      continue;
    }
    const transfer = readTransfer(target, data, value);
    if (!transfer || !balances.has(transfer.outputToken as string)) return parsed;
    const token = transfer.outputToken as string;
    balances.set(token, subtractFees(balances.get(token) ?? 0n, transfer.minOutputAmount ?? 0n));
  }
  if (payouts.length === 1) {
    const fallback = asString(args.fallbackRecipient);
    if (!isZeroWord(fallback) && fallback !== payouts[0].receiver) {
      throw new BridgeError(BRIDGE_ERRORS.ACROSS_FALLBACK_RECEIVER_MISMATCH);
    }
    if (!isZeroWord(fallback) && parsed.bridgeOutputToken !== payouts[0].outputToken) {
      throw new BridgeError(BRIDGE_ERRORS.ACROSS_FALLBACK_TOKEN_MISMATCH);
    }
    Object.assign(parsed, payouts[0]);
  }
  return parsed;
};
