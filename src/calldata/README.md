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
  handler fallback recipient must match the final payout recipient; differing
  fallback assets remain explicitly unverified. The deposit's `depositor` must match the expected user, independently
  of the final destination receiver.
- LI.FI: Celer Circle/Fast, Polymer/Standard, IntentEscrowV2, Mayan Swift/MCTP,
  Paxos, LayerSwap, Polygon, Gnosis, Superset, Frax, MegaETH, Centrifuge and M0.
  AllBridge can retain its verified receiver while skipping an unavailable output
  minimum. Garden still lacks a verified receiver and is reported as unverified. M0 has structural assertions but no complete live quote. Source swap deposits are
  kept separate from the bridge's intermediate asset and minimum amount.
  Across refund/depositor fields and IntentEscrowV2 deposit/refund owners must
  match the expected user, independently of the final receiver.
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

Socket `createRetryableTicket` requires both its call-value refund beneficiary
and excess-fee refund recipient to match the expected user.

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
minimum amount whenever it cannot be verified locally, with or without a protocol reference.
These fields remain marked unverified without generating a report for the known
local limitation. A successful build does not verify these
output conditions. Fields available from calldata or local mappings still undergo
normal comparison, including the minimum amount when it can be calculated locally.
Source payment may be less than or equal to the local `fromTokenRawAmount`, or
exceed it by at most 0.1%, using integer arithmetic. There is no lower tolerance
bound relative to local intent; an excess above 0.1% blocks the transaction.
Missing or negative amounts remain invalid.
This tolerance does not relax internal transaction/order/approval consistency.
For a locally known receive minimum, the safety floor remains 95% of the
slippage-adjusted quoted amount. Higher receive minima have no upper cap.
Encoded refund beneficiaries are exposed as `parsed.refundRecipients`; a
mismatch blocks with `BRIDGE_REFUND_RECIPIENT_MISMATCH` and `receiverPass: false`.

Unknown source token/amount and arbitrary destination execution are reported
and block the transaction. Relay and Socket RFQ/CCTP fields that require external order
data are skipped without any provider request. A missing expected output amount
also skips that comparison. All skipped fields remain in `unverifiedFields`.
Known unresolved output fields and Relay/Socket external receiver/chain fields
are not reported. Missing source fields, unknown destination execution/receivers
and a missing expected amount for a locally available minimum are still sent
through `onError` with `blocking: true`. Business callers should pass the selected
quote's exact raw output amount as `toTokenRawAmount`.
Known destination tokens, amounts and receivers still undergo normal comparison.

`buildTx` accepts `toTokenRawAmount` as an exact raw string;
`getQuoteListWithTx` supplies the quote's hexadecimal raw amount automatically.
It also accepts an exact safe integer quote amount when the hexadecimal field is
absent. Serialized quote keys are decoded before reading their raw output amount.

`buildTx` also snapshots the selected `quoteKey` before awaiting the build response.
Socket compares its original provider `quoteId` against the decoded outer ID on
every supported route, including CCTP; RFQ additionally requires the vault's
`receiveERC20` / `receiveNative` ID to match the outer ID even without a quote key.
Relay multicall/permit routes compare the key's `requestId` with decoded metadata.
When `build_tx` returns `order_data` alongside the transaction, Relay additionally
checks its order hash, payment recipients and refund recipients. Once the order
and funding are verified, its destination chain, currency and `minimumAmount`
are compared with the local intent using the same 95% receive floor described
above; a higher minimum is allowed. The expected destination chain and selected
raw quote amount are required for these checks. An unrecognized expected chain ID
keeps the existing chain-comparison skip policy; currency and amount checks still
run. Destination failures set `toPass: false` without discarding an independently
verified receiver. Multiple output payments or non-empty
destination calls are rejected as unsupported order shapes. The nested order
is read only from a final deposit call or a reviewed v3.2 cleanup wrapper to an
allowlisted depository, never from metadata or signature bytes. Missing, ambiguous
or unsupported deposits report `BRIDGE_MISSING_RELAY_ORDER_ID` when order data is
supplied. Missing order data is rejected by default. Historical replay tests can
opt out with `allowMissingRelayOrder`; production callers must leave it unset.
Receiver verification also requires funding the order's single source payment
with the matching chain, token and amount. Explicit direct deposits and simple
v3.2 Multicalls with at most one deposit approval are supported. Swap/permit flows,
unknown preceding calls and allowance-only direct deposits remain unverified and
report `BRIDGE_UNVERIFIED_RELAY_FUNDING` when order data is supplied. A correct hash
in a zero-balance cleanup is not evidence that the order received funds.
Socket/Relay backend cache keys use `providerId:cacheUUID`; only the bytes32
provider prefix is compared. Direct callers can supply the same `quoteKey` in the
expectation passed to `validateBridgeCalldata` / `validateBridgeTx`.

Relay direct-deposit `orderId` is an order hash, not this `requestId`, and is not
compared with the cache prefix. Across/Mayan cache UUIDs, LI.FI's requoted routes,
absent/unrecognized quote keys and the legacy quote+tx API have no equivalent
binding here and are skipped without missing-ID reports. No extra API requests
are made. Actual ID mismatches use `BRIDGE_QUOTE_ID_MISMATCH`,
`BRIDGE_REQUEST_ID_MISMATCH` or `BRIDGE_SOCKET_RFQ_QUOTE_ID_MISMATCH`; these block,
do not change the three field flags, and do not expose raw IDs
in reports. Matching IDs alone do not verify the quote's authenticity, full
transaction contents or final delivery conditions.

`ok: true` only means the structural checks and available comparisons passed.
It does not mean all five fields were verified. `validateBridgeCalldata` itself
does not check the outer router allowlist; `validateBridgeTx` does that separately
and returns `pass`, `routerPass`, `fromPass`, `toPass`, `receiverPass`, `errors`
and `unverifiedFields`. Reportable failures throw `InvalidBridgeCalldataError` with `pass: false`
and `blocking: true`; known skipped fields remain allowed. A field flag is false
when its group failed or was not completely verified. Unknown destination execution
does not erase an independently verified source. Raw calldata checks retain their
real failures. See [validation rollout](../../README.md#validation-rollout).
Empty or malformed calldata is reported. Missing router configuration does not
skip the allowlist check. A quote
without an approval address is allowed; an approval address with no configured
spender is rejected. When a transaction includes `chainId`, it must match the
requested source chain. Invalid, negative or unsafe numeric `value` inputs are
reported without throwing from the public calldata validation function.
When `from` is supplied, it must match the expected wallet address.

## Source transaction limits

Local destination decoding now also handles Across fallback-only payouts, direct
transfers, and drains with a shared receiver. Eco transfer sequences retain a shared
receiver even when they pay different assets. Different receivers or unrecognized
calls remain unresolved. If success and fallback pay different assets to the same
receiver, the receiver is retained while the single output token/minimum is left
unresolved without reporting the known local limitation.

The recorded Across Base USDC-to-AERO destination swap is decoded through its
reviewed AllowanceHolder/Settler deployment. The decoder requires an enforced
transfer back to the known Handler, matching input funding, and a bounded set of
reviewed actions that cannot bypass the final slippage check. An unknown Settler,
chain or action is not trusted. Deployment evidence is recorded in
`tests/fixtures/route-discovery-20261104/evidence/base-settler-verification.json`.
This is a static deployment entry, not a runtime registry or RPC query.

The 20261105 history adds canonical inner SpokePools for Ink/zkSync, the Monad
Handler, Unichain's WETH withdrawal, Socket RFQ `receiveNative(bytes32)`, and two
reviewed HyperEVM destination swaps. The HyperEVM LI.FI path is restricted to its
deployed `swapTokensSingleV3ERC20ToERC20`; both the output and possible unused
input refunds must return through Handler to the same recipient. Its approval
cannot be substituted with an AllowanceHolder approval. The reviewed HyperEVM
Settler supports an exact amount or its full-balance `MAX_UINT256` encoding,
using only locally tracked bridge funds; partial-balance ratio encodings and
unreviewed deployments/actions remain unresolved. Socket native RFQ validates
the source value, net deposit, native asset, vault and spender; its external
delivery conditions remain silently unverified like ERC20 RFQ.

The 20261111 reports add Ink's CCTP domain/USDC mapping and Plasma's Across
Handler. Eco's reviewed HyperEVM Portal can resolve an exact approve/CCTP burn
pair to its final chain and direct mint recipient. Across supports Avalanche's
reviewed UniversalRouter v2.1.2 prefunded, single-hop ERC20 V4 swap with no hooks,
full settlement and payout back to Handler; differing fallback assets stay
unverified. The reviewed Ethereum Settler additionally supports EKUBOV3 and its
full-balance funding encoding. Unknown deployments, commands, actions and partial
balance ratios remain unresolved. Deployment/source hashes and execution
constraints are recorded in `tests/fixtures/reported-20261111-evidence.json`.

LI.FI Intents callbacks can also resolve locally for the reviewed Base ReceiverOIF,
its immutable Executor/output-settler pair, and one supported ERC20 transfer or
the same reviewed Settler swap. Refund and payout recipients must agree; arbitrary
approval targets, calls and other deployments stay unresolved. The deployment
evidence is `evidence/base-lifi-oif-verification.json` in the same fixture directory.
No unsupported callback is accepted merely because its metadata contains a receiver.

OFT's `0x01` bus command without compose data retains the signed receiver; remote
asset mappings remain unresolved. FastMCTP type 1 ignores unused custom payload
bytes, while type 2 stays unresolved even when those bytes are empty. Target token
information is only populated when derivable locally; no RPC implementation is
introduced. These additions do not make arbitrary LI.FI hooks, custom Mayan
actions, CCIP receiver contracts or retryable-ticket calls verifiable.

Contract references: [Across MulticallHandler](https://github.com/across-protocol/contracts/blob/master/contracts/handlers/MulticallHandler.sol),
[Stargate bus delivery](https://github.com/stargate-protocol/stargate-v2/blob/main/packages/stg-evm-v2/src/StargateBase.sol).
The captured verified `evidence/mayan-FastMCTP.sol` defines the payload modes.

Relay and Socket RFQ vault source deposits do not expose final delivery conditions.
Socket CCTP ClaimExecutor routes expose USDC but not the final receiver or net amount.
These known missing fields are allowed without generating reports or requesting
a provider client. LI.FI LayerSwap still compares its signed `bridgeData.receiver` locally; its order is
not fetched. External destination checks are selected from decoded calldata, not
just a backend-supplied bridge ID. Source checks always run; their failures block.

The SDK has no direct-provider transport, provider cache, HTTP adapter or RPC
resolver. [Saved provider data](../providers/README.md) is used only for offline
fixture regressions. A successful lightweight build does not verify skipped
delivery conditions, and cannot be counted as a successful Relay order-hash check.

LI.FI Smart Deposits routes must be filtered by the backend at quote and build
time. The SDK does not accept a Smart Deposits flag to relax receiver comparison.
Historical intermediate-recipient mismatches block. A mismatch is not proof of
actual final misdelivery.

## Samples

The retained fixture collection contains 348 source transactions with explicit
five-field expectations, spanning 29 bridge types and 54 observed function paths.
These are fixture expectations, not a claim that every field is currently verified.
Tests compare locally available fields and assert that deferred output fields stay
unresolved; provider-assisted checks still compare their complete order data.

Captured contract-state JSON and prior replay reports are historical evidence for
the follow-up PR. The active tests no longer replay RPC responses. In particular,
the Arbitrum ETH/WETH mismatch fixture now records an unverified output token;
that mismatch cannot be rejected until token mapping checks are restored.
Unknown destination calls remain unverified and block. Across fallback to
a different token may retain a proven receiver while skipping output comparisons.
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
