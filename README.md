# rabby-bridge

Minimal bridge SDK for Rabby:

- enumerates supported bridge aggregators and chains
- maintains per-chain spender/router allowlists
- validates backend bridge quotes before returning them
- decodes source transactions for Across, LI.FI, Relay, Socket and Mayan
- keeps chain-state-dependent output fields explicitly unverified, without RPC requests
- validates Relay orders, three Socket routes and LI.FI LayerSwap through direct provider requests

See [calldata parsing](src/calldata/README.md) for supported paths, integration and verification boundaries.
See [direct provider integration](src/providers/README.md) for the shared extension/mobile
transport interface, quote binding, application-fee constraints and signing checks.

## Test

Run `yarn test` to build the package and execute the Jest suite.

See [reachable route discovery](tests/fixtures/route-discovery-20261104/README.md) for the latest parsing changes, fixture coverage and remaining verification limits.

## Lite rollout

Pass `lite: true` to `getQuote`, `buildTx` or `getQuoteListWithTx` to observe new
validation without letting it change the business decisions from `main`.
The default is `false`, retaining strict behavior.

```ts
const quotes = await getQuoteListWithTx(aggregatorId, {
  ...params,
  lite: true,
  onError: (report) => reportToBusiness(report),
}, api);
```

- Quotes and transactions come from the existing backend flow, including Relay
  and Socket. Provider quotes never replace the selected backend quote in lite mode.
- Configured Router/Spender mismatches, unsupported source chains/aggregators,
  missing required slippage, missing backend results and backend request failures
  keep their original blocking behavior.
- Calldata parsing, intent comparison, missing-field checks, stricter missing
  contract configuration and provider verification still run against the returned
  transaction. Their failures are reported without discarding that quote/transaction.
- No parser is reported as unsupported, including aggregators that strict mode
  does not currently parse. It is never reported as a successful parse.
- Relay/Socket verification uses available proof/cache for the selected transaction.
  If that proof or client is missing, the original missing-proof error is reported;
  dependent hash/order checks cannot complete. An unrelated fresh provider quote
  is not fetched or used as evidence for the backend transaction.
- LayerSwap lookup runs in the background in lite mode. Its result is reported
  through `onError` and does not delay returning the backend transaction.

`validateBridgeQuote` also accepts `{ lite, onError }` as its fourth argument;
`validateBridgeTx` accepts it after the optional expectation as its sixth argument.
Raw decode/calldata-check results remain truthful (`ok: false` on failure).
Direct provider-client methods remain strict; use the high-level entry points for
lite rollout decisions.

Error codes and details are preserved. Lite observations carry `lite: true` and
`blocking: false`; legacy failures carry `blocking: true` when reported by the
high-level flow. Keep the callback installed while background checks are pending.
Dependent checks still stop at their first unusable prerequisite, and independent
stages may emit multiple reports. These are failure-event/path counts, not distinct
user counts or a denominator for all successful transactions. No user identifiers
are added. See error reporting below for catching failures that still throw.

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
- `onError` receives failures filtered from `getQuote` / `getQuoteListWithTx`.
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
Deferred chain-state output fields remain in `unverifiedFields`; they do not
become errors merely because RPC validation is postponed.

### Privacy-safe diagnostics

Use `toBridgeErrorReport(resultOrError)` to convert a failed calldata check,
detailed decode result or exception into a report. Passing a successful result
returns `undefined`. The `onError` callback and `BridgeError.toJSON()` use the same
runtime allowlist. Do not upload the entire check, exception, parsed transaction,
request parameters or quote response.

```ts
const check = validateBridgeCalldata(aggregatorId, chainId, tx, expectation);
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
