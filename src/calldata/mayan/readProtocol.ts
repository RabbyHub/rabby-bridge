import { BRIDGE_ERRORS, asBridgeError } from '../../errors/index.js';
import { readSelector } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';
import { FAST_MCTP_BRIDGE, decodeFastMctpBridge } from './fastMctpBridge.js';
import { FAST_MCTP_CREATE_ORDER, decodeFastMctpCreateOrder } from './fastMctpCreateOrder.js';
import { SWIFT_CREATE_ORDER, decodeSwiftCreateOrder } from './swiftCreateOrder.js';
import { decodeMctpBridge, decodeMctpOrder, MCTP_BRIDGE_WITH_FEE, MCTP_CREATE_ORDER } from './mctp.js';

export const readMayanProtocol = (protocolData: string, amountFloor?: bigint): Partial<ParsedBridgeCall> | undefined => {
  const selector = readSelector(protocolData);
  try {
    if (selector === SWIFT_CREATE_ORDER) {
      return decodeSwiftCreateOrder(protocolData);
    }
    if (selector === FAST_MCTP_CREATE_ORDER) {
      return decodeFastMctpCreateOrder(protocolData);
    }
    if (selector === FAST_MCTP_BRIDGE) {
      return decodeFastMctpBridge(protocolData, amountFloor);
    }
    if (selector === MCTP_BRIDGE_WITH_FEE) return decodeMctpBridge(protocolData, amountFloor);
    if (selector === MCTP_CREATE_ORDER) return decodeMctpOrder(protocolData);
  } catch (error) {
    throw asBridgeError(error, BRIDGE_ERRORS.CALLDATA_DECODE_FAILED, { protocolSelector: selector ?? undefined });
  }
  return undefined;
};
