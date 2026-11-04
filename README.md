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
