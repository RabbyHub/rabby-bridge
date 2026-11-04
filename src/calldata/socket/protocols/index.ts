import { BRIDGE_ERRORS, BridgeError, asBridgeError } from '../../../errors/index.js';
import { innerCallDiagnostics } from '../../diagnostics.js';
import { asBigint, asString, decodeCall } from '../../abi.js';
import { readSelector } from '../../hex.js';
import type { ParsedBridgeCall } from '../../types.js';
import { readCcip } from './ccip.js';
import { readCctp } from './cctp.js';
import { readEco } from './eco.js';
import { readNativeBridge } from './native.js';
import { readOft } from './oft.js';
import { readSwapsXYZ } from './swapsXYZ.js';

const decodeSocketBridge = (data: string, target: string, token: string, value: bigint, spender: string): Partial<ParsedBridgeCall> | undefined => {
  const selector = readSelector(data);
  const native = readNativeBridge(data, target, value);
  if (native) return native;
  if (selector === '0x96f4e9f9') return readCcip(data, target);
  if (selector === '0x8e0250ee') {
    if (target !== '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d' || spender !== target || value !== 0n) {
      throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_SOCKET_CCTP_TARGET_SPENDER_OR_VALUE);
    }
    const parsed = readCctp(data);
    if (parsed.bridgeToken !== token) throw new BridgeError(BRIDGE_ERRORS.SOCKET_CCTP_TOKEN_DOES_NOT_MATCH_BRIDGE_ASSET);
    return parsed;
  }
  if (selector === '0xdf00f8fa') return readEco(data);
  if (selector === '0xc7c7f5b3' || selector === '0x2cdf0b95') return readOft(data, target, token);
  if (selector === '0x0c751e0b' || selector === '0x9be111d1') return readSwapsXYZ(data);
  if (selector === '0x823b01f9') {
    if (target !== '0x97caca78ac2a94c67643d07843f85afaa44a3ea5' || spender !== target || value !== 0n) {
      throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_SOCKET_RFQ_TARGET_SPENDER_OR_VALUE);
    }
    const a = decodeCall([{ name: 'quoteId', kind: 'bytes', size: 32 }, { name: 'token', kind: 'address' }, { name: 'amount', kind: 'uint' }], data);
    if (asString(a.token) !== token) throw new BridgeError(BRIDGE_ERRORS.SOCKET_RFQ_TOKEN_DOES_NOT_MATCH_BRIDGE_ASSET);
    return { protocolMethod: 'receiveERC20', orderId: asString(a.quoteId), bridgeToken: asString(a.token), bridgeAmount: asBigint(a.amount) };
  }
  return undefined;
};

export const readSocketBridge = (data: string, target: string, token: string, value: bigint, spender: string): Partial<ParsedBridgeCall> => {
  const diagnostics = innerCallDiagnostics(data, 'protocol');
  try {
    const parsed = decodeSocketBridge(data, target, token, value, spender);
    return { ...parsed, diagnostics: { ...parsed?.diagnostics, ...diagnostics } };
  } catch (error) {
    throw asBridgeError(error, BRIDGE_ERRORS.CALLDATA_DECODE_FAILED, diagnostics);
  }
};

const word = (data: string, offset: number): number => {
  const raw = data.slice(2 + offset * 2, 2 + (offset + 32) * 2);
  if (raw.length !== 64) throw new BridgeError(BRIDGE_ERRORS.INVALID_BRIDGE_OFFSET);
  const n = BigInt(`0x${raw}`);
  if (n > BigInt(data.length / 2)) throw new BridgeError(BRIDGE_ERRORS.BRIDGE_OFFSET_EXCEEDS_CALLDATA);
  return Number(n);
};

export const spliceBridgeAmount = (data: string, flags: bigint, amount: bigint): string => {
  if ((flags & 8n) === 0n) return data;
  const position = Number(flags >> 16n & 65535n);
  const selector = readSelector(data);
  let expected = ({
    '0xd2ce7d65': 68, '0xad58bdd1': 68, '0x8b9e4f93': 68,
    '0x838b2520': 100, '0x8e0250ee': 4, '0x823b01f9': 68, '0x2cdf0b95': 100,
  } as Record<string, number>)[selector ?? ''];
  if (selector === '0xc7c7f5b3') expected = 4 + word(data, 4) + 64;
  if (selector === '0x96f4e9f9') {
    const message = 4 + word(data, 36);
    expected = message + word(data, message + 64) + 64;
  }
  if (position !== expected || 2 + (position + 32) * 2 > data.length) throw new BridgeError(BRIDGE_ERRORS.BRIDGE_SPLICE_DOES_NOT_TARGET_THE_INPUT_AMOUNT);
  return data.slice(0, 2 + position * 2) + amount.toString(16).padStart(64, '0') + data.slice(2 + (position + 32) * 2);
};
