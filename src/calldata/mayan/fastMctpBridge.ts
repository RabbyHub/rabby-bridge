import { BRIDGE_ERRORS, BridgeError } from '../../errors/index.js';
import { asBigint, asString, decodeCall } from '../abi.js';
import { accountFromBytes32 } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';
import { mayanDestination } from './destination.js';
import { subtractFees } from '../protocols.js';

export const FAST_MCTP_BRIDGE = '0xf58b6de8';

export const decodeFastMctpBridge = (data: string, amountFloor?: bigint): Partial<ParsedBridgeCall> => {
  const args = decodeCall(
    [
      { name: 'tokenIn', kind: 'address' },
      { name: 'amountIn', kind: 'uint' },
      { name: 'redeemFee', kind: 'uint' },
      { name: 'circleMaxFee', kind: 'uint' },
      { name: 'gasDrop', kind: 'uint' },
      { name: 'destAddr', kind: 'bytes', size: 32 },
      { name: 'destDomain', kind: 'uint' },
      { name: 'referrerAddress', kind: 'bytes', size: 32 },
      { name: 'referrerBps', kind: 'uint' },
      { name: 'payloadType', kind: 'uint' },
      { name: 'minFinalityThreshold', kind: 'uint' },
      { name: 'customPayload', kind: 'bytes' },
    ],
    data
  );
  const destination = mayanDestination('cctp', asBigint(args.destDomain));
  const token = { protocol: 'cctp' as const, destinationChainId: destination.destinationChainId };
  const payloadType = asBigint(args.payloadType);
  if (payloadType !== 1n && payloadType !== 2n) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_MAYAN_PROTOCOL_CALLDATA);
  // FastMCTP.bridge hashes customPayload only for type 2; type 1 is a direct
  // payout even when the unused bytes are nonempty (verified FastMCTP.sol).
  const custom = payloadType === 2n;
  const net = subtractFees(amountFloor ?? asBigint(args.amountIn), asBigint(args.redeemFee), asBigint(args.circleMaxFee));
  const referrerBps = asBigint(args.referrerBps);
  if (referrerBps > 100n) throw new BridgeError(BRIDGE_ERRORS.INVALID_FASTMCTP_REFERRER_FEE);
  // redeem caps the destination protocol fee at 100 bps; it is not fixed by the source deposit.
  const minimum = net * (10000n - 100n - referrerBps) / 10000n;
  return {
    protocolMethod: 'bridge',
    sourceToken: asString(args.tokenIn),
    sourceAmount: asBigint(args.amountIn),
    ...destination,
    outputTokenReference: custom ? undefined : token,
    minOutputAmount: custom ? undefined : minimum,
    bridgeReceiver: accountFromBytes32(asString(args.destAddr)),
    receiver: custom ? undefined : accountFromBytes32(asString(args.destAddr)),
    destinationCallData: custom ? asString(args.customPayload) : undefined,
    referrer: accountFromBytes32(asString(args.referrerAddress)),
  };
};
