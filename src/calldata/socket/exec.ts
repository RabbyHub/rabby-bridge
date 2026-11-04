import { BRIDGE_ERRORS, BridgeError, asBridgeError } from '../../errors/index.js';
import { innerCallDiagnostics } from '../diagnostics.js';
import { asBigint, asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { readSelector } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';
import { bridge } from './bridge.js';
import { swapAndBridge } from './swapAndBridge.js';
import { isNative, NATIVE_TOKEN } from '../protocols.js';

const readInner = (data: string, value: bigint): ParsedBridgeCall | undefined => {
  const selector = readSelector(data);
  if (selector === bridge.selector) {
    return bridge.decode(data, value);
  }
  if (selector === swapAndBridge.selector) {
    return swapAndBridge.decode(data, value);
  }
  return undefined;
};

export const exec: CalldataMethod = {
  name: 'exec',
  selector: '0x2213bc0b',
  decode(data, value) {
    const args = decodeCall(
      [
        { name: 'operator', kind: 'address' },
        { name: 'token', kind: 'address' },
        { name: 'amount', kind: 'uint' },
        { name: 'target', kind: 'address' },
        { name: 'data', kind: 'bytes' },
      ],
      data
    );
    const target = asString(args.target);
    const diagnostics = innerCallDiagnostics(asString(args.data), 'router');
    if (target !== '0x50cfe7c1938db66a1a6d2e86d36f39fbef3d5c4a' || asString(args.operator) !== target) {
      throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_SOCKET_OPERATOR_OR_ROUTER, diagnostics);
    }
    let inner: ParsedBridgeCall | undefined;
    try { inner = readInner(asString(args.data), value); }
    catch (error) { throw asBridgeError(error, BRIDGE_ERRORS.CALLDATA_DECODE_FAILED, diagnostics); }
    if (!inner) {
      return {
        aggregatorId: 'socket',
        method: 'exec',
        kind: 'bridge',
        sourceToken: asString(args.token),
        sourceAmount: asBigint(args.amount),
        innerTarget: asString(args.target),
        diagnostics,
      };
    }
    const token = asString(args.token);
    if (inner.sourceToken !== token && !(isNative(token) && isNative(inner.sourceToken ?? ''))) {
      throw new BridgeError(BRIDGE_ERRORS.SOCKET_ALLOWANCE_TOKEN_MISMATCH, { ...inner.diagnostics, ...diagnostics });
    }
    if (!isNative(token) && asBigint(args.amount) !== inner.sourceAmount) {
      throw new BridgeError(BRIDGE_ERRORS.SOCKET_ALLOWANCE_AMOUNT_MISMATCH, { ...inner.diagnostics, ...diagnostics });
    }
    if (['receiveERC20', 'depositForBurn'].includes(inner.protocolMethod ?? '') &&
        value !== (isNative(token) ? inner.sourceAmount : 0n)) {
      throw new BridgeError(BRIDGE_ERRORS.SOCKET_NATIVE_VALUE_MISMATCH, { ...inner.diagnostics, ...diagnostics });
    }
    return {
      ...inner,
      diagnostics: { ...inner.diagnostics, ...diagnostics },
      sourceToken: isNative(inner.sourceToken ?? token) ? NATIVE_TOKEN : inner.sourceToken ?? token,
      sourceAmount: inner.sourceAmount ?? asBigint(args.amount),
      innerTarget: inner.innerTarget ?? asString(args.target),
    };
  },
};
