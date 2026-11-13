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

## Reading the validation code

1. `src/quote.ts`: `buildTx` receives the backend transaction; `checkBridgeTx`
   combines router checks, calldata checks, Relay order verification and the final decision.
2. `src/calldata/<aggregator>/`: decode protocol calls. `receiver` is the final
   recipient; `innerTarget` and `bridgeReceiver` may be intermediate contracts.
3. `src/calldata/expect.ts`: compare decoded fields with local intent and record
   what remains unverified. It does not decide which missing fields may be skipped.
4. `src/providers/relay.ts`: `verifyRelayOrder` binds backend `order_data` to the
   deposit hash. The other provider readers support offline evidence tests.

For the policy boundaries, start with `tests/calldata/receiver-policy.test.js`,
`tests/calldata/quote-identifiers.test.js` and `tests/validation.test.js`.

## Test

Run `yarn test` to build the package and execute the Jest suite.

See [test organization](tests/README.md) for fixture locations and focused test commands, and [captured route evidence](tests/fixtures/quotes/routes/README.md) for route coverage and verification limits.

## Validation rollout

Router/Spender allowlists and required calldata checks are always enforced.
Reported calldata failures block: `validateBridgeTx` and `buildTx` throw
`InvalidBridgeCalldataError`, and `getQuoteListWithTx` filters the failed quote.
No provider API or RPC requests are made.

```ts
const quotes = await getQuoteListWithTx(aggregatorId, {
  ...params,
  onError: (report) => reportToBusiness(report),
}, api);
```

- Quotes and transactions come from the existing backend flow, including Relay
  and Socket. The SDK no longer accepts `providerClient` or exposes
  a direct-provider client/fetch adapter.
- Router/Spender mismatches, unsupported source chains/aggregators,
  missing required slippage, missing backend results and backend request failures
  keep their original blocking behavior.
- Source token, source amount, supplied sender/chain and protocol structure are
  checked locally. Missing source fields and mismatches are reported.
- Socket compares the selected quote's provider ID with the outer calldata ID;
  RFQ also compares the outer ID with the vault deposit ID. Relay API request IDs
  are not compared with multicall metadata. Relay instead binds `order_data` to
  the actual deposit order hash. See the [binding limits](src/calldata/README.md).
- Known destination tokens, minimum amounts and chains are compared. Unknown
  destination paths remain unverified and are reported with available method,
  selector and nested-call diagnostics.
- Locally derivable final receivers are compared. Relay requires `order_data`
  from the matching build, verifies its hash and recipients, then compares its
  destination terms. No provider request is needed. Missing Relay order data blocks
  unless a historical test explicitly uses `allowMissingRelayOrder`.
- Parse failures, known mismatches and unexpected missing fields are reported with
  `pass: false, blocking: true`.
- Socket RFQ deposits into the fixed vault and CCTP mints to the allowlisted
  ClaimExecutor may omit the final receiver. Once their required checks pass,
  they are allowed without a receiver report; `receiverPass` remains false.
  Arbitrary contract recipients do not receive this exception. LayerSwap compares
  its locally encoded receiver; no background order lookup runs.
- Known unresolved output token/minimum fields and permitted external delivery
  fields stay in `unverifiedFields` without producing reports.
  Missing source fields, unknown receivers/paths and a missing expected amount
  for a locally available minimum use `BRIDGE_UNVERIFIED_BRIDGE_FIELDS`.
  Actual mismatches retain their existing error codes. Repeated failures are not
  deduplicated, sampled or rate-limited by the SDK.

`validateBridgeTx` accepts `{ onError }` after the optional expectation as its sixth
argument. A missing Router allowlist or an approval address without a configured
spender is rejected.

`validateBridgeTx` now returns `BridgeValidationResult` instead of `true`:

```ts
const result = validateBridgeTx(aggregatorId, chainId, bridgeId, tx, expectation);
// Throws on required-check failures; otherwise result.pass is true.
// result.fromPass / result.toPass / result.receiverPass
// result.unverifiedFields / result.errors
```

The three field flags are true only when all required local comparisons for that
group succeeded. False means a failure or an incomplete check; `errors` and
`unverifiedFields` distinguish them. Known skipped fields can leave `errors` empty
while a field flag is false. Without an expectation, field flags are false.
Validation rejects reportable failures, not every false field flag: known skipped
fields remain allowed. For example, a valid Socket RFQ deposit can return
`pass: true, receiverPass: false, errors: []` with `receiver` in `unverifiedFields`.
This is an intentional policy outcome, not a receiver mismatch or a verified payout.
There is no `lite` switch; the required checks and these exceptions always apply.
Router rejection still throws
`InvalidBridgeContractError`; its sanitized detail carries `pass: false`,
`routerPass: false` and `blocking: true`.

Raw decode/calldata-check results retain `ok: false` on failure. Failure
details include all five pass flags, path diagnostics and `blocking`.
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
  Calldata failures are reported once before throwing; do not report those
  errors again in a caller's catch when an `onError` reporter is supplied.
  Other directly thrown errors are handled by the caller.
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
Results without reportable failures return `undefined`,
including known skipped destination fields.
The `onError` callback and `BridgeError.toJSON()` use the same
runtime allowlist. Do not upload the entire check, exception, parsed transaction,
request parameters or quote response.

```ts
try {
  validateBridgeTx(aggregatorId, chainId, bridgeId, tx, expectation);
} catch (error) {
  reportToBusiness(toBridgeErrorReport(error));
  throw error;
}
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
