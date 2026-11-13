import { asArray, asBigint, asRecord, asString, decodeCall, decodeParameters } from './abi.js';
import { readSelector } from './hex.js';
import { isNative, NATIVE_TOKEN } from './protocols.js';

// Reviewed UniversalRouter v2.1.2; see reported-20261111-evidence.json.
export const AVALANCHE_UNIVERSAL_ROUTER = '0x661e93cca42afacb172121ef892830ca3b70f08d';

export const readUniversalRouterSwap = (data: string, recipient: string) => {
  if (readSelector(data) !== '0x24856bc3') return undefined;
  const execution = decodeCall([
    { name: 'commands', kind: 'bytes' },
    { name: 'inputs', kind: 'array', item: { name: 'input', kind: 'bytes' } },
  ], data);
  const inputs = asArray(execution.inputs);
  // No optional/reverting commands or unrelated transfers may bypass the payout.
  if (asString(execution.commands) !== '0x10' || inputs.length !== 1) return undefined;
  const plan = decodeParameters([
    { name: 'actions', kind: 'bytes' },
    { name: 'params', kind: 'array', item: { name: 'param', kind: 'bytes' } },
  ], asString(inputs[0]));
  const params = asArray(plan.params).map(asString);
  if (asString(plan.actions) !== '0x070b0e' || params.length !== 3) return undefined;
  const swap = asRecord(decodeParameters([{ name: 'swap', kind: 'tuple', components: [
    { name: 'currencyIn', kind: 'address' },
    { name: 'path', kind: 'array', item: { name: 'hop', kind: 'tuple', components: [
      { name: 'intermediateCurrency', kind: 'address' }, { name: 'fee', kind: 'uint' },
      { name: 'tickSpacing', kind: 'uint' }, { name: 'hooks', kind: 'address' }, { name: 'hookData', kind: 'bytes' },
    ] } },
    { name: 'minHopPriceX36', kind: 'array', item: { name: 'price', kind: 'uint' } },
    { name: 'amountIn', kind: 'uint' }, { name: 'amountOutMinimum', kind: 'uint' },
  ] }], params[0]).swap);
  const path = asArray(swap.path).map(asRecord);
  const prices = asArray(swap.minHopPriceX36);
  // shortcut: one ERC20 hop without hooks; review additional V4 plans before support.
  if (path.length !== 1 || prices.length > 1) return undefined;
  const hop = path[0];
  const inputToken = asString(swap.currencyIn), outputToken = asString(hop.intermediateCurrency);
  const inputAmount = asBigint(swap.amountIn), minOutputAmount = asBigint(swap.amountOutMinimum);
  if (isNative(inputToken) || isNative(outputToken) || inputToken === outputToken ||
      asString(hop.hooks) !== NATIVE_TOKEN || asString(hop.hookData) !== '0x' ||
      asBigint(hop.fee) > 1_000_000n || asBigint(hop.tickSpacing) <= 0n || asBigint(hop.tickSpacing) > 32767n ||
      inputAmount <= 0n || inputAmount >= (1n << 128n) || minOutputAmount <= 0n || minOutputAmount >= (1n << 128n)) return undefined;
  const settle = decodeParameters([
    { name: 'currency', kind: 'address' }, { name: 'amount', kind: 'uint' }, { name: 'payerIsUser', kind: 'bool' },
  ], params[1]);
  const take = decodeParameters([
    { name: 'currency', kind: 'address' }, { name: 'recipient', kind: 'address' }, { name: 'amount', kind: 'uint' },
  ], params[2]);
  // OPEN_DELTA (0) settles the swap's debt from Router and takes all output back to Handler.
  if (asString(settle.currency) !== inputToken || asBigint(settle.amount) !== 0n || settle.payerIsUser !== false ||
      asString(take.currency) !== outputToken || asString(take.recipient) !== recipient || asBigint(take.amount) !== 0n) return undefined;
  return { inputToken, inputAmount, outputToken, minOutputAmount };
};
