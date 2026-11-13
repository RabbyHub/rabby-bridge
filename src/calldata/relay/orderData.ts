import { BRIDGE_ERRORS, BridgeError } from '../../errors/index.js';

export type JsonObject = Record<string, unknown>;

export const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError(BRIDGE_ERRORS.INVALID_OBJECT);
  return value as JsonObject;
};

export const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new BridgeError(BRIDGE_ERRORS.INVALID_ARRAY);
  return value;
};

export const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new BridgeError(BRIDGE_ERRORS.INVALID_STRING);
  return value;
};

export const address = (value: unknown): string => {
  const result = text(value).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(result)) throw new BridgeError(BRIDGE_ERRORS.INVALID_ADDRESS);
  return result;
};

export const bytes = (value: unknown, size?: number): string => {
  const result = text(value).toLowerCase();
  if (!/^0x([0-9a-f]{2})*$/.test(result) || (size !== undefined && result.length !== 2 + size * 2)) throw new BridgeError(BRIDGE_ERRORS.INVALID_BYTES);
  return result;
};

export const uint = (value: unknown, bits = 256): bigint => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new BridgeError(BRIDGE_ERRORS.UNSAFE_NUMBER);
  if (!['string', 'number', 'bigint'].includes(typeof value) || !/^(0x[0-9a-f]+|[0-9]+)$/i.test(String(value))) throw new BridgeError(BRIDGE_ERRORS.INVALID_AMOUNT);
  const n = BigInt(value as string | number | bigint);
  if (n < 0n || n >= 1n << BigInt(bits)) throw new BridgeError(BRIDGE_ERRORS.INVALID_AMOUNT);
  return n;
};
