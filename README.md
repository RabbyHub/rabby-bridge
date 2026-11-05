# rabby-bridge

Minimal bridge SDK for Rabby:

- enumerates supported bridge aggregators and chains
- maintains per-chain spender/router allowlists
- validates backend bridge quotes before returning them
- decodes source transactions for Across, LI.FI, Relay, Socket and Mayan
- keeps chain-state-dependent output fields explicitly unverified, without RPC requests
- performs local validation only; no direct-provider HTTP requests or RPC reads

See [calldata parsing](src/calldata/README.md) for supported paths, integration and verification boundaries.
See [offline provider evidence](src/providers/README.md) for retained historical fixtures and verification limits.

## Test

Run `yarn test` to build the package and execute the Jest suite.

See [reachable route discovery](tests/fixtures/route-discovery-20261104/README.md) for the latest parsing changes, fixture coverage and remaining verification limits.

## Validation rollout

The first rollout enforces Router/Spender allowlists and observes local calldata
validation. No provider API or RPC requests are made. `buildTx` and
`getQuoteListWithTx` keep the original backend transaction when source, destination
or receiver checks fail or cannot be completed; `onError` receives those observations.

```ts
const quotes = await getQuoteListWithTx(aggregatorId, {
  ...params,
  onError: (report) => reportToBusiness(report),
}, api);
```

- Quotes and transactions come from the existing backend flow, including Relay
  and Socket, in both modes. The SDK no longer accepts `providerClient` or exposes
  a direct-provider client/fetch adapter.
- Router/Spender mismatches, unsupported source chains/aggregators,
  missing required slippage, missing backend results and backend request failures
  keep their original blocking behavior.
- Source token, source amount, supplied sender/chain and protocol structure are
  checked locally. Missing source fields and mismatches are reported.
- Known destination tokens, minimum amounts and chains are compared. Unknown
  destination paths remain unverified and are reported with available method,
  selector and nested-call diagnostics.
- Locally derivable final receivers are compared. External order data is skipped
  without a provider request; a skipped receiver is never counted as verified.
- Parse failures, known mismatches and unexpected missing fields are reported with
  `blocking: false`, including when `lite` is omitted or false.
- Relay and Socket RFQ/CCTP external destination fields are skipped rather than
  fetched. LayerSwap uses its local receiver; no background order lookup runs.
  Skipping an external receiver does not claim order-hash or provider verification.
- Known unresolved output token/minimum fields and Relay/Socket external
  receiver/chain fields stay in `unverifiedFields` without producing reports.
  Missing source fields, unknown receivers/paths and a missing expected amount
  for a locally available minimum use `BRIDGE_UNVERIFIED_BRIDGE_FIELDS`.
  Actual mismatches retain their existing error codes. Repeated failures are not
  deduplicated, sampled or rate-limited by the SDK.

`validateBridgeQuote` also accepts `{ lite, onError }` as its fourth argument;
`validateBridgeTx` accepts it after the optional expectation as its sixth argument.
`lite` retains its legacy missing-spender behavior; it no longer selects strict
calldata enforcement and never skips a missing Router allowlist.

`validateBridgeTx` now returns `BridgeValidationResult` instead of `true`:

```ts
const result = validateBridgeTx(aggregatorId, chainId, bridgeId, tx, expectation);
// result.pass === result.routerPass
// result.fromPass / result.toPass / result.receiverPass
// result.unverifiedFields / result.errors
```

The three field flags are true only when all required local comparisons for that
group succeeded. False means a failure or an incomplete check; `errors` and
`unverifiedFields` distinguish them. Known skipped fields can leave `errors` empty
while a field flag is false. Without an expectation, field flags are false.
They do not contribute to `pass` in this rollout. Router rejection still throws
`InvalidBridgeContractError`; its sanitized detail carries `pass: false`,
`routerPass: false` and `blocking: true`.

Raw decode/calldata-check results retain `ok: false` on failure. Observation
details include all five pass flags, path diagnostics, `lite` and `blocking: false`.
These are failure-event/path counts, not distinct user counts or a denominator for
all successful transactions. See error reporting below for failures that still throw.

## Error reporting

All stable error codes, stages and messages are defined in
[`BRIDGE_ERRORS`](src/errors/constants.ts). Codes are explicit constants; callers
must not classify errors by matching message text. Existing error classes and
legacy `reason` fields remain available.

- `decodeBridgeCalldataResult(aggregatorId, tx)` returns a detailed success/failure
  result. The existing `decodeBridgeCalldata` still returns `null` on failure.
- `validateBridgeCalldata` returns `errors`, plus `error_code` and `stage` on failure.
  Independent intent mismatches are collected together; decoding or dependent
  protocol operations stop at their first failure.
- Thrown SDK errors extend `BridgeError`. Use `error.toJSON()` for a report.
- `onError` receives failures filtered from `getQuote` / `getQuoteListWithTx`,
  plus local validation failures and unexpected missing fields from transaction checks.
  Directly thrown errors are handled by the caller, avoiding duplicate reporting.
  Reporting callback failures do not affect validation or quote filtering.

```ts
import { BridgeError, getQuoteListWithTx } from '@rabby-wallet/rabby-bridge';

try {
  const quotes = await getQuoteListWithTx(aggregatorId, {
    ...params,
    onError: (report) => reportToBusiness(report),
  }, api);
} catch (error) {
  if (error instanceof BridgeError) reportToBusiness(error.toJSON());
  throw error;
}
```

A report contains a primary `error_code` / `stage` and an `errors` list. The primary
code is the first failure; inspect the list for every collected failure. Each detail
contains its fixed message and available context: aggregator, chain, bridge,
provider, operation, method, selector, nested protocol selector, missing fields or
HTTP status. SDK reports omit wallet addresses, amounts, raw calldata, response
bodies and arbitrary transport exception messages. Existing Error messages are
retained for compatibility; prefer `toJSON()` for reporting.

Stages distinguish input checks, contract allowlists, ABI decoding, protocol
structure, intent comparison, provider requests, provider responses, transaction
binding and completeness. Unexpected uncategorized failures use `BRIDGE_UNKNOWN`.
Deferred chain-state output fields remain in `unverifiedFields` without producing
reports merely because a known local limitation prevents verification.

### Privacy-safe diagnostics

Use `toBridgeErrorReport(resultOrError)` to convert a calldata check,
transaction validation result, detailed decode result or exception into a report.
A transaction with `pass: true` can still produce an observation report when its
`errors` are nonempty. Results without reportable failures return `undefined`,
including known skipped destination fields.
The `onError` callback and `BridgeError.toJSON()` use the same
runtime allowlist. Do not upload the entire check, exception, parsed transaction,
request parameters or quote response.

```ts
const check = validateBridgeTx(aggregatorId, chainId, bridgeId, tx, expectation);
const report = toBridgeErrorReport(check);
if (report) reportToBusiness(report);
```

Reports can retain recognized aggregator/bridge/method labels, source/destination
chains, outer/router/protocol selectors, call-data format and byte lengths, ABI
failure offsets, bounded destination-call selectors/counts, unsupported command
bytes/counts, static request categories and HTTP status. Nested diagnostics are
collected where the parser knows the call layout; arbitrary payload bytes are not
scanned for possible selectors. Destination selector lists are deduplicated and
limited to 16 entries.

Unknown labels become `unknown` or are omitted. Messages and stages are restored
from the error-code catalogue, even if an error was modified after construction.
Arbitrary properties are dropped, including wallet/receiver/refund addresses,
token addresses, amounts, balances, approvals, transaction/order/quote/request IDs,
signatures, full calldata, URL/query/header/body contents, raw exception messages
and stack traces. Contract addresses and hashes are not reported either.

These reports identify unsupported function families and failure stages. They
intentionally cannot reconstruct or identify the original user's transaction.
