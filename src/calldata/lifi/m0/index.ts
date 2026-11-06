import { BRIDGE_ERRORS, BridgeError } from '../../../errors/index.js';
import { asBigint, asRecord, asString, type AbiParam } from '../../abi.js';
import { accountFromBytes32 } from '../../hex.js';
import { knownCompare } from '../../expect.js';
import { lifiBridgeMethod } from '../method.js';
import { bridgeShape } from '../shape.js';

const m0Data: AbiParam = { name: 'm0Data', kind: 'tuple', components: [
  { name: 'receiverAddress', kind: 'bytes', size: 32 }, { name: 'refundRecipient', kind: 'address' },
  { name: 'orderOwner', kind: 'address' }, { name: 'tokenOut', kind: 'bytes', size: 32 },
  { name: 'solver', kind: 'bytes', size: 32 }, { name: 'amountOut', kind: 'uint' },
  { name: 'fillDeadline', kind: 'uint' },
] };

const fill: Parameters<typeof lifiBridgeMethod>[4] = (parsed, args) => {
  const data = asRecord(args.m0Data);
  if ((parsed.destinationChainId ?? 0n) > 0xffffffffn) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_NON_EVM_M0_DESTINATION);
  const receiver = accountFromBytes32(asString(data.receiverAddress));
  if (receiver !== parsed.receiver) throw new BridgeError(BRIDGE_ERRORS.M0_RECEIVER_MISMATCH);
  if (asString(data.refundRecipient) !== receiver || asString(data.orderOwner) !== receiver) {
    throw new BridgeError(BRIDGE_ERRORS.M0_REFUND_RECIPIENT_MISMATCH);
  }
  parsed.receiver = receiver;
  parsed.outputToken = accountFromBytes32(asString(data.tokenOut));
  // Positive source-swap slippage scales amountOut up; the quoted amount remains its floor.
  parsed.minOutputAmount = asBigint(data.amountOut);
};

export const methods = [
  lifiBridgeMethod('startBridgeTokensViaM0', '0x65782c4b', [m0Data], false, fill),
  lifiBridgeMethod('swapAndStartBridgeTokensViaM0', '0xb9eaf86d', [m0Data], true, fill),
];
export const compare = knownCompare;
export const check = bridgeShape;
