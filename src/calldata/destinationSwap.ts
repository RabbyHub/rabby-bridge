import { asArray, asBigint, asRecord, asString, decodeCall } from './abi.js';
import { readSelector } from './hex.js';
import { isNative, NATIVE_TOKEN } from './protocols.js';

export const ALLOWANCE_HOLDER = '0x0000000000001ff3684f28c67538d4d072c22734';

// Reviewed deployment, not a dynamic registry lookup. Evidence and renewal limits:
// tests/fixtures/route-discovery-20261104/evidence/base-settler-verification.json
const SETTLERS: Record<string, string> = { 8453: '0x7d6839415693801e94cdc4a7d732c9a3fdbbd1d7' };

export const readSettlerSwap = (data: string, chain: bigint | undefined, recipient: string) => {
  if (readSelector(data) !== '0x2213bc0b') return undefined;
  const args = decodeCall([
    { name: 'operator', kind: 'address' }, { name: 'token', kind: 'address' },
    { name: 'amount', kind: 'uint' }, { name: 'target', kind: 'address' }, { name: 'data', kind: 'bytes' },
  ], data);
  const settler = SETTLERS[chain?.toString() ?? ''];
  if (!settler || asString(args.target) !== settler || asString(args.operator) !== settler ||
      isNative(asString(args.token)) || asBigint(args.amount) <= 0n) return undefined;
  const inner = asString(args.data);
  if (readSelector(inner) !== '0x1fff991f') return undefined;
  const execution = decodeCall([
    { name: 'slippage', kind: 'tuple', components: [
      { name: 'recipient', kind: 'address' }, { name: 'buyToken', kind: 'address' }, { name: 'minAmountOut', kind: 'uint' },
    ] },
    { name: 'actions', kind: 'array', item: { name: 'action', kind: 'bytes' } },
    { name: 'zid', kind: 'bytes', size: 32 },
  ], inner);
  const slippage = asRecord(execution.slippage);
  if (asString(slippage.recipient) !== recipient || asString(slippage.buyToken) === NATIVE_TOKEN ||
      asBigint(slippage.minAmountOut) <= 0n) return undefined;
  const actions = asArray(execution.actions).map(asString);
  // These reviewed actions cannot mutate/zeroize slippage. CHECK_SLIPPAGE, SELECT
  // and unreviewed actions must not bypass the final enforced transfer to Handler.
  if (!actions.length || readSelector(actions[0]) !== '0xc1fb425e' ||
      actions.slice(1).some((action) => !['0x38c9c147', '0x8d68a156', '0x5f80abae'].includes(readSelector(action) ?? ''))) return undefined;
  const funding = decodeCall([
    { name: 'recipient', kind: 'address' }, { name: 'token', kind: 'address' },
    { name: 'amount', kind: 'uint' }, { name: 'nonce', kind: 'uint' },
    { name: 'deadline', kind: 'uint' }, { name: 'signature', kind: 'bytes' },
  ], actions[0]);
  if (asString(funding.recipient) !== settler || asString(funding.token) !== asString(args.token) ||
      asBigint(funding.amount) !== asBigint(args.amount) || asString(funding.signature) !== '0x') return undefined;
  return {
    inputToken: asString(args.token), inputAmount: asBigint(args.amount),
    outputToken: isNative(asString(slippage.buyToken)) ? NATIVE_TOKEN : asString(slippage.buyToken),
    minOutputAmount: asBigint(slippage.minAmountOut),
  };
};
