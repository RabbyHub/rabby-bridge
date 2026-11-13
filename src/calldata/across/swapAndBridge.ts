import { BRIDGE_ERRORS, BridgeError } from '../../errors/index.js';
import { applyAcrossMessage } from '../destination.js';
import { asBigint, asRecord, asString, decodeCall, type AbiParam } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { accountFromBytes32 } from '../hex.js';
import { NATIVE_TOKEN } from '../protocols.js';

const swapAndDepositData: AbiParam = {
  name: 'swapAndDepositData',
  kind: 'tuple',
  components: [
    {
      name: 'submissionFees',
      kind: 'tuple',
      components: [
        { name: 'amount', kind: 'uint' },
        { name: 'recipient', kind: 'address' },
      ],
    },
    {
      name: 'depositData',
      kind: 'tuple',
      components: [
        { name: 'inputToken', kind: 'address' },
        { name: 'outputToken', kind: 'bytes', size: 32 },
        { name: 'outputAmount', kind: 'uint' },
        { name: 'depositor', kind: 'address' },
        { name: 'recipient', kind: 'bytes', size: 32 },
        { name: 'destinationChainId', kind: 'uint' },
        { name: 'exclusiveRelayer', kind: 'bytes', size: 32 },
        { name: 'quoteTimestamp', kind: 'uint' },
        { name: 'fillDeadline', kind: 'uint' },
        { name: 'exclusivityParameter', kind: 'uint' },
        { name: 'message', kind: 'bytes' },
      ],
    },
    { name: 'swapToken', kind: 'address' },
    { name: 'exchange', kind: 'address' },
    { name: 'transferType', kind: 'uint' },
    { name: 'swapTokenAmount', kind: 'uint' },
    { name: 'minExpectedInputTokenAmount', kind: 'uint' },
    { name: 'routerCalldata', kind: 'bytes' },
    { name: 'enableProportionalAdjustment', kind: 'bool' },
    { name: 'spokePool', kind: 'address' },
    { name: 'nonce', kind: 'uint' },
  ],
};

export const swapAndBridge: CalldataMethod = {
  name: 'swapAndBridge',
  selector: '0x110560ad',
  decode(data, value) {
    const args = asRecord(decodeCall([swapAndDepositData], data).swapAndDepositData);
    const depositData = asRecord(args.depositData);
    const sourceAmount = asBigint(args.swapTokenAmount);
    if (value > 0n && value !== sourceAmount) throw new BridgeError(BRIDGE_ERRORS.ACROSS_SWAP_VALUE_MISMATCH);
    return applyAcrossMessage({
      aggregatorId: 'across',
      method: 'swapAndBridge',
      kind: 'bridge',
      depositor: asString(depositData.depositor),
      sourceToken: value > 0n ? NATIVE_TOKEN : asString(args.swapToken),
      sourceAmount,
      destinationChainId: asBigint(depositData.destinationChainId),
      receiver: accountFromBytes32(asString(depositData.recipient)),
      outputToken: accountFromBytes32(asString(depositData.outputToken)),
      minOutputAmount: asBigint(depositData.outputAmount),
      spokePool: asString(args.spokePool),
      innerTarget: asString(args.exchange),
    }, asString(depositData.message));
  },
};
