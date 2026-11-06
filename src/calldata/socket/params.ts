import type { AbiParam } from '../abi.js';

export const input: AbiParam = { name: 'input', kind: 'tuple', components: [
  { name: 'user', kind: 'address' }, { name: 'inputToken', kind: 'address' }, { name: 'inputAmount', kind: 'uint' },
] };
export const fee: AbiParam = { name: 'fee', kind: 'tuple', components: [
  { name: 'receiver', kind: 'address' }, { name: 'amount', kind: 'uint' },
] };
export const swapData: AbiParam = { name: 'swapData', kind: 'tuple', components: [
  { name: 'target', kind: 'address' }, { name: 'approvalSpender', kind: 'address' },
  { name: 'outputToken', kind: 'address' }, { name: 'value', kind: 'uint' },
  { name: 'minOutput', kind: 'uint' }, { name: 'returnDataWordOffset', kind: 'uint' },
] };
export const bridgeData: AbiParam = { name: 'bridgeData', kind: 'tuple', components: [
  { name: 'target', kind: 'address' }, { name: 'approvalSpender', kind: 'address' }, { name: 'value', kind: 'uint' },
] };
