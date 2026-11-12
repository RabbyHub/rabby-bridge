import { BRIDGE_ERRORS, BridgeError, asBridgeError } from '../errors/index.js';
import { asArray, asBigint, asRecord, asString, decodeCall, decodeParameters, type AbiParam, type AbiValue } from './abi.js';
import { isZeroWord, readSelector } from './hex.js';
import { NATIVE_TOKEN, WRAPPED_NATIVE_TOKENS, subtractFees } from './protocols.js';
import type { ParsedBridgeCall } from './types.js';
import { calldataDiagnostics } from './diagnostics.js';
import { ALLOWANCE_HOLDER, HYPEREVM_LIFI_ROUTER, readLifiSwap, readSettlerSwap } from './destinationSwap.js';
import { AVALANCHE_UNIVERSAL_ROUTER, readUniversalRouterSwap } from './destinationUniswap.js';

export const destinationCall: AbiParam = {
  name: 'call', kind: 'tuple', components: [
    { name: 'target', kind: 'address' }, { name: 'data', kind: 'bytes' }, { name: 'value', kind: 'uint' },
  ],
};

export const readTransfer = (target: string, data: string, value: bigint): Partial<ParsedBridgeCall> | undefined => {
  if (data === '0x' && value > 0n) return { receiver: target, outputToken: NATIVE_TOKEN, minOutputAmount: value };
  if (value !== 0n || readSelector(data) !== '0xa9059cbb') return undefined;
  const args = decodeCall([{ name: 'to', kind: 'address' }, { name: 'amount', kind: 'uint' }], data);
  return { receiver: asString(args.to), outputToken: target, minOutputAmount: asBigint(args.amount) };
};

export const readDestinationTransfers = (calls: AbiValue[]): Partial<ParsedBridgeCall> => {
  const diagnostics = { destinationCallCount: calls.length,
    destinationSelectors: [...new Set(calls.map((call) => calldataDiagnostics(asRecord(call).data).selector)
      .filter((selector): selector is string => Boolean(selector)))].slice(0, 16) };
  const transfers = calls.map((call) => {
    const c = asRecord(call);
    return readTransfer(asString(c.target), asString(c.data), asBigint(c.value));
  });
  if (!transfers.length || transfers.some((transfer) => !transfer)) return { diagnostics };
  const first = transfers[0] as Partial<ParsedBridgeCall>;
  if (!transfers.every((transfer) => transfer?.receiver === first.receiver)) return { diagnostics };
  // Different assets can have one recipient without having one comparable output amount.
  if (!transfers.every((transfer) => transfer?.outputToken === first.outputToken)) return { receiver: first.receiver, diagnostics };
  return { ...first, diagnostics, minOutputAmount: transfers.reduce((sum, transfer) => sum + (transfer?.minOutputAmount ?? 0n), 0n) };
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
  143: '0xec41f75c686e376ab2a4f18bde263ab5822c4511',
  999: '0x5e7840e06faccb6d1c3b5f5e0d1d3d07f2829bba',
  4663: '0xa8ad2e87e2043711d8bec77e8bc3e2683c0ab6bd',
  9745: '0x5e7840e06faccb6d1c3b5f5e0d1d3d07f2829bba',
  43114: '0x9610954acdca5ff7905f051a040ce33fe613c60e',
};

const readAcrossMessage = (parsed: ParsedBridgeCall, message: string): ParsedBridgeCall => {
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
  parsed.diagnostics = { hasDestinationCall: true, destinationCalldataBytes: calldataDiagnostics(message).calldataBytes };
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
  const calls = asArray(args.calls);
  parsed.diagnostics.destinationCallCount = calls.length;
  parsed.diagnostics.destinationSelectors = [...new Set(calls.map((call) => calldataDiagnostics(asRecord(call).callData).selector)
    .filter((selector): selector is string => Boolean(selector)))].slice(0, 16);
  const balances = new Map<string, bigint>([[parsed.bridgeOutputToken as string, parsed.bridgeOutputAmount as bigint]]);
  const payouts: Partial<ParsedBridgeCall>[] = [];
  const directTransfers: Partial<ParsedBridgeCall>[] = [];
  const approvals = new Map<string, bigint>();
  const lifiRouter = parsed.destinationChainId === 999n ? HYPEREVM_LIFI_ROUTER : undefined;
  const possibleRefundTokens = new Set<string>();
  const refundReceivers: string[] = [];
  for (let index = 0; index < calls.length; index++) {
    const call = asRecord(calls[index]);
    const target = asString(call.target);
    const data = asString(call.callData);
    const value = asBigint(call.value);
    const selector = readSelector(data);
    // emitData is telemetry; its amounts are not an enforced receive floor.
    if (selector === '0xd836083e' && target === emitter && value === 0n) continue;
    if (selector === '0x095ea7b3' && value === 0n && balances.has(target)) {
      const approval = decodeCall([{ name: 'spender', kind: 'address' }, { name: 'amount', kind: 'uint' }], data);
      const amount = asBigint(approval.amount);
      const spender = asString(approval.spender);
      if ((spender !== ALLOWANCE_HOLDER && spender !== lifiRouter) ||
          (amount > (balances.get(target) ?? 0n) && amount !== (1n << 256n) - 1n)) return parsed;
      approvals.set(`${target}:${spender}`, amount);
      continue;
    }
    if ((target === ALLOWANCE_HOLDER || target === lifiRouter) && value === 0n) {
      const swap = target === ALLOWANCE_HOLDER
        ? readSettlerSwap(data, parsed.destinationChainId, handler, balances)
        : readLifiSwap(data, parsed.destinationChainId, target, handler);
      const approvalKey = `${swap?.inputToken}:${target}`;
      if (!swap || (approvals.get(approvalKey) ?? 0n) < swap.inputAmount ||
          (balances.get(swap.inputToken) ?? 0n) < swap.inputAmount) return parsed;
      approvals.set(approvalKey, (approvals.get(approvalKey) ?? 0n) - swap.inputAmount);
      balances.set(swap.inputToken, (balances.get(swap.inputToken) ?? 0n) - swap.inputAmount);
      balances.set(swap.outputToken, (balances.get(swap.outputToken) ?? 0n) + swap.minOutputAmount);
      // GenericSwapFacet returns unused input to Handler; its later payout must agree too.
      if (target === lifiRouter) possibleRefundTokens.add(swap.inputToken);
      continue;
    }
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
      if (parsed.destinationChainId === 43114n && asString(drain.receiver) === AVALANCHE_UNIVERSAL_ROUTER) {
        if (index + 1 >= calls.length) return parsed;
        const next = asRecord(calls[index + 1]);
        if (asString(next.target) !== AVALANCHE_UNIVERSAL_ROUTER || asBigint(next.value) !== 0n) return parsed;
        const swap = readUniversalRouterSwap(asString(next.callData), handler);
        if (!swap || swap.inputToken !== token || swap.inputAmount !== amount) return parsed;
        balances.set(token, 0n);
        balances.set(swap.outputToken, (balances.get(swap.outputToken) ?? 0n) + swap.minOutputAmount);
        index++;
        continue;
      }
      if (possibleRefundTokens.delete(token)) refundReceivers.push(asString(drain.receiver));
      if (amount > 0n) payouts.push({ outputToken: token, minOutputAmount: amount, receiver: asString(drain.receiver) });
      balances.set(token, 0n);
      continue;
    }
    const transfer = readTransfer(target, data, value);
    if (!transfer || !balances.has(transfer.outputToken as string)) return parsed;
    const token = transfer.outputToken as string;
    balances.set(token, subtractFees(balances.get(token) ?? 0n, transfer.minOutputAmount ?? 0n));
    directTransfers.push(transfer);
  }
  const fallback = asString(args.fallbackRecipient);
  const hasDrain = payouts.length > 0;
  // The Handler drains the original bridge asset to fallback even after successful calls.
  const remaining = balances.get(parsed.bridgeOutputToken as string) ?? 0n;
  if (!isZeroWord(fallback) && possibleRefundTokens.delete(parsed.bridgeOutputToken as string)) {
    refundReceivers.push(fallback);
  }
  if (!isZeroWord(fallback) && remaining > 0n) {
    payouts.push({ receiver: fallback, outputToken: parsed.bridgeOutputToken, minOutputAmount: remaining });
    balances.set(parsed.bridgeOutputToken as string, 0n);
  }
  // Existing drain routes may contain explicit fee transfers; without a drain every
  // direct transfer must agree on the recipient, and no tracked funds may be stranded.
  const delivered = hasDrain
    ? [...payouts, ...directTransfers.filter((transfer) => transfer.receiver === payouts[0].receiver)]
    : [...directTransfers, ...payouts];
  if (delivered.length && !possibleRefundTokens.size && [...balances.values()].every((amount) => amount === 0n)) {
    const receiver = delivered[0].receiver;
    if (!delivered.every((payout) => payout.receiver === receiver) ||
        !refundReceivers.every((recipient) => recipient === receiver)) return parsed;
    if (!isZeroWord(fallback) && fallback !== receiver) {
      throw new BridgeError(BRIDGE_ERRORS.ACROSS_FALLBACK_RECEIVER_MISMATCH);
    }
    parsed.receiver = receiver;
    const token = delivered[0].outputToken;
    if (delivered.every((payout) => payout.outputToken === token) &&
        (isZeroWord(fallback) || token === parsed.bridgeOutputToken)) {
      parsed.outputToken = token;
      parsed.minOutputAmount = delivered.reduce((sum, payout) => sum + (payout.minOutputAmount ?? 0n), 0n);
    }
    // Different success/fallback assets do not invalidate a shared receiver, but
    // neither asset nor a single minimum can be claimed for both outcomes.
  }
  return parsed;
};

export const applyAcrossMessage = (parsed: ParsedBridgeCall, message: string): ParsedBridgeCall => {
  try { return readAcrossMessage(parsed, message); }
  catch (error) { throw asBridgeError(error, BRIDGE_ERRORS.CALLDATA_DECODE_FAILED, parsed.diagnostics); }
};
