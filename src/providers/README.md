# Relay runtime verification and offline provider evidence

The SDK does not expose `createBridgeProviderClient`,
`createBridgeFetchRequest`, provider transports or the `providerClient` parameter.
All quotes/builds use the existing backend APIs; SDK validation makes no extra
Relay, Socket or LayerSwap HTTP requests and no RPC requests.

`relay.ts::verifyRelayOrder` runs during `buildTx` / `validateBridgeTx`. It checks
backend `order_data` against the deposit order hash, verifies recipients and
refunds, and populates destination terms for comparison with local intent. Missing
order data blocks by default. It does not prove intermediate funding or final delivery.

Socket RFQ/ClaimExecutor final receivers remain unverified under the existing
fixed-contract policy. LayerSwap's locally encoded receiver is compared while its
unavailable destination token/minimum is skipped. Expected user addresses and
backend display fields are never substituted for verified fields.

The other pure data readers, including `readRelayQuote`, support offline fixture
regressions. They do not fetch data and are not exported from the package root.
Tests replay captured Relay order hashes, Socket historical transaction links and
LayerSwap records. Their historical provider checks must not be confused with
the runtime signing checks in `src/quote.ts`.
