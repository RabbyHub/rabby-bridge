import { BRIDGE_ERRORS, BridgeError } from '../errors/index.js';
import { toUtf8String, Utf8ErrorFuncs } from '@ethersproject/strings';
import { bytesToHex, hexToBytes } from './hex.js';
import type { ParsedBridgeCall } from './types.js';

export type AbiParam = {
  name: string;
  kind: 'address' | 'uint' | 'bool' | 'bytes' | 'string' | 'array' | 'tuple';
  size?: number;
  length?: number;
  item?: AbiParam;
  components?: AbiParam[];
};

export type AbiValue =
  | string
  | bigint
  | boolean
  | AbiValue[]
  | { [key: string]: AbiValue };

const isDynamic = (param: AbiParam): boolean => {
  if (param.kind === 'string') {
    return true;
  }
  if (param.kind === 'bytes') {
    return param.size === undefined;
  }
  if (param.kind === 'array') {
    return param.length === undefined || isDynamic(param.item as AbiParam);
  }
  if (param.kind === 'tuple') {
    return (param.components ?? []).some(isDynamic);
  }
  return false;
};

const staticWordCount = (param: AbiParam): number => {
  if (isDynamic(param)) {
    return 1;
  }
  if (param.kind === 'tuple') {
    return (param.components ?? []).reduce((sum, item) => sum + staticWordCount(item), 0);
  }
  if (param.kind === 'array') {
    return (param.length ?? 0) * staticWordCount(param.item as AbiParam);
  }
  return 1;
};

const readWord = (buf: Uint8Array, offset: number): bigint => {
  if (offset < 0 || offset + 32 > buf.length) {
    throw new BridgeError(BRIDGE_ERRORS.ABI_WORD_OUT_OF_BOUNDS, { abiOffset: offset, abiBufferBytes: buf.length });
  }
  let value = 0n;
  for (let index = 0; index < 32; index += 1) {
    value = (value << 8n) + BigInt(buf[offset + index]);
  }
  return value;
};

const toAddress = (word: bigint): string => {
  if (word >= (1n << 160n)) throw new BridgeError(BRIDGE_ERRORS.INVALID_ABI_ADDRESS);
  return `0x${word.toString(16).padStart(40, '0')}`;
};

const readByteLength = (buf: Uint8Array, offset: number): number => {
  const length = readWord(buf, offset);
  if (length > BigInt(buf.length)) {
    throw new BridgeError(BRIDGE_ERRORS.ABI_BYTES_OUT_OF_BOUNDS, { abiOffset: offset, abiBufferBytes: buf.length });
  }
  return Number(length);
};

const readDynamicBytes = (buf: Uint8Array, offset: number): string => {
  const length = readByteLength(buf, offset);
  const start = offset + 32;
  if (start + length > buf.length) {
    throw new BridgeError(BRIDGE_ERRORS.ABI_BYTES_OUT_OF_BOUNDS, { abiOffset: offset, abiBufferBytes: buf.length });
  }
  return bytesToHex(buf.subarray(start, start + length));
};

const decodeSequence = (params: AbiParam[], buf: Uint8Array, base: number): AbiValue[] => {
  let cursor = base;
  const locations: number[] = [];
  for (const param of params) {
    if (isDynamic(param)) {
      const relative = readWord(buf, cursor);
      if (relative > BigInt(buf.length)) {
        throw new BridgeError(BRIDGE_ERRORS.ABI_OFFSET_OUT_OF_BOUNDS, { abiOffset: cursor, abiBufferBytes: buf.length });
      }
      locations.push(base + Number(relative));
      cursor += 32;
    } else {
      locations.push(cursor);
      cursor += staticWordCount(param) * 32;
    }
  }
  return params.map((param, index) => decodeAt(param, buf, locations[index]));
};

const decodeAt = (param: AbiParam, buf: Uint8Array, offset: number): AbiValue => {
  switch (param.kind) {
    case 'address':
      return toAddress(readWord(buf, offset));
    case 'uint':
      return readWord(buf, offset);
    case 'bool': {
      const word = readWord(buf, offset);
      if (word !== 0n && word !== 1n) {
        throw new BridgeError(BRIDGE_ERRORS.INVALID_BOOL);
      }
      return word === 1n;
    }
    case 'bytes': {
      if (param.size === undefined) {
        return readDynamicBytes(buf, offset);
      }
      if (offset + 32 > buf.length) {
        throw new BridgeError(BRIDGE_ERRORS.ABI_WORD_OUT_OF_BOUNDS, { abiOffset: offset, abiBufferBytes: buf.length });
      }
      return bytesToHex(buf.subarray(offset, offset + param.size));
    }
    case 'string':
      return toUtf8String(readDynamicBytes(buf, offset), Utf8ErrorFuncs.replace).replace(/^\uFEFF/, '');
    case 'tuple':
      return decodeTuple(param.components ?? [], buf, offset);
    case 'array': {
      const item = param.item as AbiParam;
      if (param.length === undefined) {
        const length = readByteLength(buf, offset);
        if (length > 2048) {
          throw new BridgeError(BRIDGE_ERRORS.ABI_ARRAY_TOO_LONG);
        }
        return decodeSequence(Array.from({ length }, () => item), buf, offset + 32);
      }
      return decodeSequence(Array.from({ length: param.length }, () => item), buf, offset);
    }
    default:
      throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_ABI_TYPE);
  }
};

const decodeTuple = (
  components: AbiParam[],
  buf: Uint8Array,
  offset: number
): { [key: string]: AbiValue } => {
  const values = decodeSequence(components, buf, offset);
  return Object.fromEntries(components.map((component, index) => [component.name, values[index]]));
};

export const decodeCall = (params: AbiParam[], calldata: string): { [key: string]: AbiValue } => {
  const bytes = hexToBytes(calldata);
  if (bytes.length < 4) {
    throw new BridgeError(BRIDGE_ERRORS.MISSING_SELECTOR);
  }
  const values = decodeSequence(params, bytes.subarray(4), 0);
  return Object.fromEntries(params.map((param, index) => [param.name, values[index]]));
};

export const decodeParameters = (params: AbiParam[], data: string): { [key: string]: AbiValue } => {
  const values = decodeSequence(params, hexToBytes(data), 0);
  return Object.fromEntries(params.map((param, index) => [param.name, values[index]]));
};

export const asRecord = (value: AbiValue): { [key: string]: AbiValue } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeError(BRIDGE_ERRORS.EXPECTED_TUPLE);
  }
  return value;
};

export const asArray = (value: AbiValue): AbiValue[] => {
  if (!Array.isArray(value)) {
    throw new BridgeError(BRIDGE_ERRORS.EXPECTED_ARRAY);
  }
  return value;
};

export const asBigint = (value: AbiValue): bigint => {
  if (typeof value !== 'bigint') {
    throw new BridgeError(BRIDGE_ERRORS.EXPECTED_UINT);
  }
  return value;
};

export const asString = (value: AbiValue): string => {
  if (typeof value !== 'string') {
    throw new BridgeError(BRIDGE_ERRORS.EXPECTED_STRING);
  }
  return value;
};

export type CalldataMethod = {
  name: string;
  selector: string;
  decode: (data: string, value: bigint) => ParsedBridgeCall;
};
