# Bridge calldata parsing

`decodeBridgeCalldata(aggregatorId, tx)` decodes the source token/amount,
destination token/minimum amount and final receiver where the source transaction
commits to them. All amounts are `bigint` in the corresponding token's raw units.
`minOutputAmount` is a signed constraint or a protocol-derived lower bound, not
the historical amount actually received.

See [error reporting](../../README.md#error-reporting) for diagnostic decoding,
structured exceptions and filtered-quote reporting.

## Paths

- Across: deposit variants, source swap + deposit, and the known MulticallHandler's
  fee transfers, wrapped-native withdrawal and final token drain. Handler
  `emitData(bytes)` is telemetry and supplies no enforceable receive minimum.
  An embedded SpokePool must match the source chain's configured pool. A nonzero
  handler fallback recipient and asset must match the final payout recipient
  and asset. The deposit's `depositor` must match the expected user, independently
  of the final destination receiver.
- LI.FI: Celer Circle/Fast, Polymer/Standard, IntentEscrowV2, Mayan Swift/MCTP,
  Paxos, LayerSwap, Polygon, Gnosis, Superset, Frax, MegaETH, Centrifuge and M0.
  AllBridge and Garden expose partial constraints and remain rejected by high-level
  validation. M0 has structural assertions but no complete live quote. Source swap deposits are
  kept separate from the bridge's intermediate asset and minimum amount.
- Socket OpenRouter: direct/source-swap routes through RFQ vault, Eco,
  CCTP V2/Fast/Slow, CCIP, OFT V1/V2, Stargate Pool/OFT through the OFT interface,
  Hyperlane via swaps-xyz, and native
  Polygon/Gnosis/Arbitrum/OP Stack/Robinhood bridges. AllowanceHolder `exec` must
  use the known OpenRouter as both operator and target; its ERC20 temporary
  allowance must equal the source input amount. Amount splicing may only replace
  the bridge input amount.
  RFQ/CCTP calls must use the recognized vault/messenger and matching spender.
  Their deposited token and direct-deposit amount must match the router input
  after fees, and native value must equal the native source input or zero for ERC20.
- Mayan Forwarder: direct/source-swap forwards to Swift, FastMCTP orders/bridges
  and MCTP orders/bridges. Circle domains, Wormhole IDs and EVM chain IDs are
  separate namespaces; native output order amounts are converted locally, while
  ERC20 output amounts requiring token decimals remain unresolved.
- Relay: depository and multicall inputs; depositor/refund address is not reported
  as the final destination receiver. Multicall metadata is a `requestId`, not a
  verified order hash.

## Deferred chain-state checks

The SDK does not request RPC state or accept a state resolver. Token mappings,
recipient-code-dependent Across delivery, Celer fees and ERC20 amount conversions
that need chain state are deferred to a follow-up PR. Protocol-defined CCTP USDC
addresses, supported network IDs and native-token amount conversions remain local.

`outputTokenReference` and `outputAmountReference` describe the unresolved fields;
they are not resolved from backend quote values. Inspect:

- `parsed.unresolvedFields`: fields that could not be derived locally.
- `check.unverifiedFields`: fields not compared against the local intent.
- `check.errors`: coded failures with stage and context; empty for a passing check.
- `bridgeToken`, `bridgeAmount`, `bridgeReceiver`, `bridgeOutputToken` and
  `bridgeOutputAmount`: intermediate bridge conditions, separate from final delivery.

`buildTx` / `getQuoteListWithTx` temporarily allow an unresolved output token or
minimum amount only when the parser supplies its corresponding protocol reference.
These fields remain marked unverified. A successful build does not verify these
output conditions. Fields available from calldata or local mappings still undergo
normal comparison, including the minimum amount when it can be calculated locally.
Source payment may equal the local `fromTokenRawAmount` or exceed it by at most
0.1%, using integer arithmetic. A smaller payment or any excess above 0.1% rejects.
This tolerance does not relax internal transaction/order/approval consistency.

Other unverified fields still reject, including the source token/amount, final
receiver, unknown destination chain, output conditions without a protocol reference,
and a missing expected output amount for a locally derived minimum. Unsupported
destination calls remain rejected. Provider-order requirements are unchanged.

`buildTx` accepts `toTokenRawAmount` as an exact raw string;
`getQuoteListWithTx` supplies the quote's hexadecimal raw amount automatically.
It also accepts an exact safe integer quote amount when the hexadecimal field is
absent. Serialized quote keys are decoded before reading their raw output amount.

`ok: true` only means the structural checks and available comparisons passed.
It does not mean all five fields were verified. `validateBridgeCalldata` itself
does not check the outer router allowlist; `validateBridgeTx` does that separately.
For supported calldata aggregators, `validateBridgeTx` rejects empty or malformed
calldata. Missing router configuration does not skip the allowlist check. A quote
without an approval address is allowed; an approval address with no configured
spender is rejected. When a transaction includes `chainId`, it must match the
requested source chain. Invalid, negative or unsafe numeric `value` inputs are
rejected without throwing from the public calldata validation function.
When `from` is supplied, it must match the expected wallet address.

## Source transaction limits

Relay and Socket RFQ vault source deposits do not expose final delivery conditions.
The separate [provider client](../providers/README.md) requests Relay protocol.v2
order data directly and hashes it locally; source-only decoding does not. LI.FI LayerSwap's
signed `bridgeData.receiver` is returned, while its destination token and amount
remain in the associated order. Socket CCTP transactions minting to the ClaimExecutor
return destination USDC as the output token; final receiver and net amount depend
on destination authorization, including the relay fee, and stay unresolved.
Arbitrary destination payloads stay unresolved unless their execution semantics
are explicitly supported. Validation rejects an unsupported destination call
instead of silently skipping its cleared destination fields. This is separate
from the partial deposit routes above, whose missing order conditions are still
reported through `unresolvedFields` and `unverifiedFields`.
The high-level `buildTx` requires a cached direct-provider quote for Relay and
Socket RFQ/CCTP ClaimExecutor routes. For LayerSwap it directly queries unfunded
orders by receiver and matches calldata `requestId` to the provider's sequence
number, then checks destination token/minimum against local intent. Its separately
returned provider verification has binding `provider-record`; pure source decoding
still reports those two fields as unresolved. Missing clients/records or a backend
mislabeling partial calldata cannot bypass the check. Source calldata parsing remains synchronous and does not perform RPC reads.

## Samples

The retained fixture collection contains 348 source transactions with explicit
five-field expectations, spanning 29 bridge types and 53 observed function paths.
These are fixture expectations, not a claim that every field is currently verified.
Tests compare locally available fields and assert that deferred output fields stay
unresolved; provider-assisted checks still compare their complete order data.

Captured contract-state JSON and prior replay reports are historical evidence for
the follow-up PR. The active tests no longer replay RPC responses. In particular,
the Arbitrum ETH/WETH mismatch fixture now records an unverified output token;
that mismatch cannot be rejected until token mapping checks are restored.
Unknown destination calls and different-token Across fallback remain rejected.
Historical Relay/Socket replay is distinct from signing-time transaction verification;
Relay multicall history coverage does not expand the direct depository verifier.

FastMCTP direct bridge minimums include redeem/Circle fees, the signed referrer
fee and the destination protocol fee cap of 100 bps. This is a conservative bound;
the quoted receive amount cannot replace it when checking a user's threshold.

Protocol references: [LI.FI facets](https://github.com/lifinance/contracts/tree/main/src/Facets),
[Mayan SDK](https://github.com/mayan-finance/swap-sdk),
[Stargate contracts](https://github.com/stargate-protocol/stargate-v2/tree/main/packages/stg-evm-v2/src),
[Frax HopV2](https://github.com/FraxFinance/hop-v2),
[LayerZero network metadata](https://metadata.layerzero-api.com/v1/metadata).
