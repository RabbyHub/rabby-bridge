import { CCTP_USDC, isNative } from './protocols.js';
import type { BridgeTokenReference, ParsedBridgeCall } from './types.js';

const tokenInfo = (reference: BridgeTokenReference) => {
  if (reference.protocol === 'cctp' && reference.destinationChainId !== undefined) {
    const token = CCTP_USDC[reference.destinationChainId.toString()];
    if (token) return { token, decimals: 6 };
  }
  if (reference.protocol === 'token' && reference.token && isNative(reference.token)) {
    return { token: reference.token, decimals: 18 };
  }
  return undefined;
};

export const resolveParsed = (parsed: ParsedBridgeCall): ParsedBridgeCall => {
  const info = parsed.outputTokenReference ? tokenInfo(parsed.outputTokenReference) : undefined;
  if (info) parsed.outputToken = info.token;
  const amount = parsed.outputAmountReference;
  if (amount?.kind === 'normalized' && parsed.minOutputAmount === undefined) {
    const metadata = tokenInfo(amount.token);
    if (metadata) {
      const sourceDecimals = Math.min(metadata.decimals, amount.decimals ?? 8);
      parsed.minOutputAmount = amount.amount * 10n ** BigInt(metadata.decimals - sourceDecimals);
    }
  }
  parsed.unresolvedFields = ['sourceToken', 'sourceAmount', 'outputToken', 'minOutputAmount', 'receiver']
    .filter((field) => parsed[field as keyof ParsedBridgeCall] === undefined);
  return parsed;
};
