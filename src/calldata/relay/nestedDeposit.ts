import { depositErc20 } from './depositErc20.js';
import { depositErc20Allowance } from './depositErc20Allowance.js';
import { depositNative } from './depositNative.js';
import { asArray, asBigint, asRecord, asString, decodeCall, type AbiValue } from '../abi.js';
import { BRIDGE_ROUTER_WHITELIST } from '../../list.js';
import { isZeroWord, readSelector } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';
import { NATIVE_TOKEN } from '../protocols.js';

const DEPOSITORIES = new Set(Object.values(BRIDGE_ROUTER_WHITELIST.relay));
// shortcut: reviewed v3.2 cleanup wrappers only; review new deployments before adding them.
const PROXY_ROUTERS: Record<string, string> = {
  '0x5567954cd026cebfe486062cb75848e0f1c12e58': '0x0729e2a4716d9f7dd17858d5d504426d228697f7',
  '0xe4dfbd5e6784db1058124e2c87554c0591f0fb7b': '0x6328ea02d28131e58b28e55c6258258a30d90e05',
};
const ROUTERS = new Set(Object.values(PROXY_ROUTERS));
export const relayFundingRouter = (method: string, target: string): string | undefined =>
  method === 'transferAndMulticall' ? PROXY_ROUTERS[target]
    : method === 'multicall' && ROUTERS.has(target) ? target : undefined;
const CLEANUP_NATIVE = '0x5d1fe6a2';
const CLEANUP_ERC20 = '0x73b7bb2f';

/** Read one final deposit from actual calls, never from metadata or signatures. */
export const nestedRelayOrder = (
  rawCalls: AbiValue, funding?: { token: string; amount: bigint }
): Pick<ParsedBridgeCall, 'orderId' | 'depositor' | 'innerTarget' | 'bridgeToken' | 'bridgeAmount' | 'bridgeReceiver'> | undefined => {
  try {
    const calls = asArray(rawCalls).map(asRecord);
    if (!calls.length) return undefined;
    // Multiple deposit/cleanup calls cannot be bound to a single backend order.
    if (calls.slice(0, -1).some((call) => DEPOSITORIES.has(asString(call.target)) ||
        (ROUTERS.has(asString(call.target)) && [CLEANUP_NATIVE, CLEANUP_ERC20].includes(readSelector(asString(call.callData)) ?? '')))) return undefined;
    const last = calls[calls.length - 1];
    if (last.allowFailure !== false) return undefined;
    let target = asString(last.target), data = asString(last.callData);
    const wrapper = ROUTERS.has(target) ? target : undefined;
    let value = asBigint(last.value);
    let token: string | undefined;
    let nativeCleanup = false;
    let cleanupAmount: bigint | undefined;
    if (ROUTERS.has(target)) {
      if (value !== 0n) return undefined;
      if (readSelector(data) === CLEANUP_NATIVE) {
        const args = decodeCall([{ name: 'amount', kind: 'uint' }, { name: 'to', kind: 'address' }, { name: 'data', kind: 'bytes' }], data);
        target = asString(args.to);
        data = asString(args.data);
        value = asBigint(args.amount);
        cleanupAmount = value;
        nativeCleanup = true;
      } else if (readSelector(data) === CLEANUP_ERC20) {
        const args = decodeCall([
          { name: 'tokens', kind: 'array', item: { name: 'token', kind: 'address' } },
          { name: 'tos', kind: 'array', item: { name: 'to', kind: 'address' } },
          { name: 'datas', kind: 'array', item: { name: 'data', kind: 'bytes' } },
          { name: 'amounts', kind: 'array', item: { name: 'amount', kind: 'uint' } },
        ], data);
        if (Object.values(args).some((items) => asArray(items).length !== 1)) return undefined;
        target = asString(asArray(args.tos)[0]);
        data = asString(asArray(args.datas)[0]);
        token = asString(asArray(args.tokens)[0]);
        cleanupAmount = asBigint(asArray(args.amounts)[0]);
      } else return undefined;
    }
    if (!DEPOSITORIES.has(target)) return undefined;
    const method = [depositNative, depositErc20, depositErc20Allowance].find((item) => item.selector === readSelector(data));
    if (!method || (nativeCleanup && method !== depositNative) || (token && method === depositNative)) return undefined;
    const parsed = method.decode(data, value);
    if (isZeroWord(parsed.orderId) || (token && token !== parsed.sourceToken)) return undefined;
    const result = { orderId: parsed.orderId, depositor: parsed.depositor, innerTarget: target };
    if (!funding || funding.amount <= 0n || funding.token !== parsed.sourceToken) return result;
    // shortcut: only one approval before deposit; add funding analysis before supporting swaps/other calls.
    const prefix = calls.slice(0, -1);
    if (prefix.length > 1) return result;
    let approved: bigint | undefined;
    if (prefix.length) {
      const call = prefix[0];
      if (funding.token === NATIVE_TOKEN || call.allowFailure !== false ||
          asString(call.target) !== funding.token || asBigint(call.value) !== 0n ||
          readSelector(asString(call.callData)) !== '0x095ea7b3') return result;
      const args = decodeCall([{ name: 'spender', kind: 'address' }, { name: 'amount', kind: 'uint' }], asString(call.callData));
      if (asString(args.spender) !== target) return result;
      approved = asBigint(args.amount);
    }
    // Zero cleanup means all remaining balance; here the full input is still on Router.
    const amount = cleanupAmount === 0n ? funding.amount : cleanupAmount;
    const depositAmount = method === depositErc20Allowance ? amount ?? approved
      : nativeCleanup ? amount : parsed.sourceAmount;
    if (depositAmount !== funding.amount ||
        (cleanupAmount !== undefined && amount !== funding.amount) ||
        (method !== depositNative && value !== 0n)) return result;
    return { ...result, bridgeToken: funding.token, bridgeAmount: funding.amount, bridgeReceiver: wrapper };
  } catch {
    // Unknown or malformed calls leave the order unresolved for the signing check.
    return undefined;
  }
};
