# Direct provider validation

`createBridgeProviderClient` owns provider request construction, quote state and
validation. A caller-supplied `BridgeServiceRequest` performs HTTP and returns the
decoded JSON body. No HTTP library or Rabby backend passthrough is required.

## Integration shared by extension and mobile

```ts
import {
  buildTx,
  createBridgeFetchRequest,
  createBridgeProviderClient,
  getQuote,
  isDirectBridgeProviderRoute,
} from '@rabby-wallet/rabby-bridge';

// React Native: use its Fetch implementation directly.
// Extension: inject a transport backed by its background/service worker instead.
const providerClient = createBridgeProviderClient({
  request: createBridgeFetchRequest(fetch),
  timeoutMs: 15_000,
});

const params = {
  userAddress,
  fromChainId,
  fromTokenId,
  fromTokenRawAmount,
  toChainId,
  toTokenId,
  slippage: '0.01', // fraction: 1%
  feeRate: 0, // percent; Socket public API supports no application-fee parameters
  providerClient,
};

const quotes = await getQuote(aggregatorId, params, openapi);
// Display these returned quotes; never substitute a backend quote for Relay or
// the three Socket provider routes below.
const selected = quotes[0];
const buildParams = {
  ...params,
  bridgeId: selected.bridge_id,
  quoteKey: selected.quote_key,
  toTokenRawAmount: selected.to_token_raw_amount_hex_str,
};
const tx = await buildTx(aggregatorId, buildParams, openapi);

// If wallet preparation can change the transaction, recheck its final signing
// payload with the same client and current local intent immediately before signing.
if (isDirectBridgeProviderRoute(aggregatorId, selected.bridge_id)) {
  const verified = providerClient.verifyTx(aggregatorId, buildParams, tx);
  // verified.parsed contains all five fields, in raw bigint units.
} else if (aggregatorId === 'lifi' && selected.bridge_id === 'layerswap') {
  // buildTx has already fetched and checked this exact order from LayerSwap.
  const verified = providerClient.verifyTx('layerswap', buildParams, tx);
}

// On wallet lock, account changes or leaving the flow:
providerClient.clear();
```

Keep the same client instance from quote selection through final verification.
It stores only an in-memory quote/proof cache; rebuilding the client requires a
new direct quote. A changed address, chain, token, input amount, output quote,
slippage or application fee rejects the old quote. `clear()` invalidates both
stored quotes and pending responses. Amounts used for comparison remain bigint;
the legacy quote's numeric display fields are not a validation source.
When comparing source payment to local intent, up to 0.1% excess is accepted.
Order amounts, transaction amounts and approval amounts still have to agree with
one another; changing local intent still invalidates an already cached quote.
Direct-provider quote keys also retain the selected raw output amount. Reusing a
Socket quote ID with a changed output amount invalidates the earlier selection.
The SDK also guards backend waits against `clear()`. Host-side asynchronous
preparation can use `captureContext()` and call the returned guard after awaiting.
Verification checks transaction intent and binding, without quote/order/signature
expiry checks or a cache TTL. Protocol deadlines remain in their ABI and Relay
order hash. The cache is bounded to 100 entries and can be invalidated by `clear()`.

On the extension, keep this client in one trusted execution context and inject a
background HTTP transport. Do not send an `AbortSignal` through extension message
serialization: transport cancellation can use its own request ID. The SDK's
timeout rejects even when the transport cannot cancel its underlying request.
The background handler must independently restrict origins/paths before fetching.
React Native can use the Fetch adapter directly. Both hosts must pass raw provider
responses without Rabby OpenAPI routing, signing plugins or Rabby auth headers.
Client code is not installed into either application by this SDK change.

Provider failures retain their error codes when wrapped in `InvalidBridgeProviderError`.
Use `error.toJSON()` when catching direct client failures. Calls through `getQuote`
report filtered Socket failures via `params.onError`; see [error reporting](../../README.md#error-reporting).

## Provider behavior

For observational deployment, high-level `lite: true` uses backend quote/build
results and only verifies those selected transactions. Relay/Socket require matching
cached proof; missing proof is reported without blocking. LayerSwap verification
runs in the background. Direct client methods remain strict and no independent
provider re-quote is used to validate a different backend selection.

- **Relay**: `GET /chains`, cached for the client's lifetime, and
  `POST /quote/v2` with `includeProtocolData: true`. The SDK normalizes supported
  EVM v1 orders using the official settlement schema and recomputes the EIP-712
  order hash. It compares that hash with both `protocol.v2.orderId` and the source
  deposit's ID, then checks the canonical depository, depositor, source currency,
  amount and native value. Recipient, destination chain/currency and the actual
  minimum come from the hashed order. Single-input/single-payment direct
  `depositNative` / `depositErc20` orders without destination calls are supported.
  Other versions, VMs, deposit addresses and multicall orders reject explicitly.
  Source approval steps are checked for token, spender and exact input amount;
  only the spender is exposed, so the host constructs its own approval.
  The first quote uses two requests to load chain metadata and the full quote.
  Later quotes reuse the metadata and make one quote request, including after
  `clear()`. `buildTx` and `verifyTx` reuse the verified quote locally and make
  zero requests. Missing protocol data rejects the quote immediately.
  Protocol-to-EVM chain IDs are pinned in the SDK and checked against `/chains`.
  The source depository must also match the SDK's per-chain canonical router.
  New protocol chain identifiers require a reviewed SDK mapping update.
- **Socket RFQ vault, CCTP V2 and CCTP V2 Slow**: `GET /v3/swap/quote` returns the
  original transaction and delivery terms together. The SDK keeps both and checks
  their source input, quote IDs and available protocol output constraints. The
  provider's `output.minAmountOut` is the final minimum, rather than a later status
  response's possibly gross minted amount. At signing, `to`, `data`, `value`,
  `chainId` and `from` must match that saved transaction exactly. Its verification
  binding is `provider-transaction`, not a locally recomputable order hash.
  The RFQ vault and Circle messenger targets, bridge spenders, bridge assets and
  native value are checked locally. Final receiver and amount still rely on the
  provider's destination authorization. A compromised authorized signing service
  can approve different delivery terms despite a matching quote response.
- **LI.FI LayerSwap**: `GET /api/v2/explorer/{receiver}?page=N` also returns
  unfunded orders (`user_transfer_pending`, no input transaction). The SDK matches
  calldata `layerSwapData.requestId` exactly against `swap.metadata.sequence_number`;
  the UUID and LI.FI transaction ID are not substituted for that identifier. It
  checks source/destination chains, the actual bridge asset/amount after source
  swap/fees, and the destination receiver. Destination token and minimum come
  directly from `swap.destination_token` and `quote.min_receive_amount`, and the
  provider's expected output must match the selected raw quote amount. The final
  minimum comparison floors to the provider-declared destination token precision
  (e.g. 8 decimal places for ETH). Source value and refund recipient are checked
  independently. A changed payout, ambiguous ID, missing record, malformed response
  or failed lookup rejects. Funding status does not affect this safety comparison.
  This is a `provider-record` association, not Relay's local order hash proof.

Relay quotes bypass the Rabby quote/build endpoints. When a provider client is
supplied, the three Socket quotes replace the corresponding backend quotes;
other Socket routes keep the existing backend + local calldata path. Their
`buildTx` uses the provider's saved transaction rather than the backend builder.
If the direct Socket request fails, its three routes are omitted and independently
validated routes from the backend remain available.
LI.FI's quote and builder remain in the existing flow; LayerSwap `buildTx` performs
the independent lookup after decoding the actual source transaction. No order data
is passed through Rabby's backend. The lookup scans at most ten pages within the
configured timeout, ignores unrelated orders and rejects repeated pages. The raw
selected output amount is required (`toTokenRawAmount`, preferably the quote's hex
string, or an exact safe quote-key amount). Its checked source transaction is
cached for final `verifyTx('layerswap', ...)` until explicitly cleared or evicted
by the cache size limit. `verifyLayerSwapTx(params, tx)` can also run the independent
lookup explicitly. Without the client, these five provider-assisted paths cannot
build. A backend cannot bypass this by relabeling partial calldata as another ID.

The synchronous `decodeBridgeCalldata` / `validateBridgeCalldata` /
`validateBridgeTx` APIs still inspect only source calldata and built-in protocol mappings.
They do not perform HTTP and do not imply full provider-order verification. Use
the provider client result to distinguish `order-hash`, `provider-transaction` and
`provider-record`.

## Endpoints and application fees

The SDK pins these origins and paths; it never follows quote-supplied URLs:

- `https://api.relay.link`: `GET /chains`, `POST /quote/v2`.
- `https://public-backend.socket.tech`: `GET /v3/swap/quote` (default).
- `https://dedicated-backend.socket.tech`: the same quote path, only with explicit
  `socketApi: 'dedicated'` configuration.
- `https://api.layerswap.io`: `GET /api/v2/explorer/{receiver}?page=N`.

Socket's public API rejects application-fee parameters. Set `feeRate: 0` explicitly
for that API; the SDK never silently drops a nonzero requested fee. Default
`feeRate` remains 0.25 percent. Retaining application fees requires Socket-approved
client access to the dedicated API; the host transport can attach credentials
restricted to that service. Existing private server credentials must not be
embedded in extension/mobile bundles. Provider fees may still apply on public
quotes. Application-fee recipients use the SDK's fixed Rabby address.

Requests time out and fail closed. Missing protocol data, changed
transactions and incomplete destination conditions never fall back to trusting
backend quote fields. LayerSwap records are queried by recipient; the same field
checks also apply to completed historical orders.

References: [Relay input validation](https://docs.relay.link/references/api/api_core_concepts/input-validation),
[Socket quotes](https://docs.socket.tech/api-reference/swap/get-quotes),
[Relay order types](https://github.com/relayprotocol/settlement-protocol/tree/main/packages/sdk).
