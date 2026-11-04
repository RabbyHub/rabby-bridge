import { BRIDGE_ERRORS, BridgeError } from '../errors/index.js';
const HEX = '0123456789abcdef';

export const normalizeHex = (value: string): string => {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new BridgeError(BRIDGE_ERRORS.INVALID_HEX);
  }
  return hex.toLowerCase();
};

export const hexToBytes = (value: string): Uint8Array => {
  const hex = normalizeHex(value);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export const bytesToHex = (bytes: Uint8Array): string => {
  let hex = '0x';
  for (const byte of bytes) {
    hex += HEX[byte >> 4] + HEX[byte & 15];
  }
  return hex;
};

export const readSelector = (data: string): string | null => {
  try {
    const hex = normalizeHex(data || '0x');
    if (hex.length < 8 || /^0+$/.test(hex.slice(0, 8))) {
      return null;
    }
    return `0x${hex.slice(0, 8)}`;
  } catch {
    return null;
  }
};

export const isZeroWord = (value?: string): boolean => {
  return !value || /^0x0*$/i.test(value);
};

export const accountFromBytes32 = (word: string): string => {
  const body = word.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  if (body.slice(0, 24) === '0'.repeat(24)) {
    return `0x${body.slice(24)}`;
  }
  return `0x${body}`;
};
