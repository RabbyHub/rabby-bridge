# Tests

Tests and fixtures are grouped by behavior and protocol. Capture dates, source
filenames and existing case IDs stay in the data for traceability; they do not
determine where new files belong.

```text
tests/
  *.test.js                 Public APIs, validation, errors and chain configuration
  calldata/
    *.test.js               Shared decoding, receivers, refunds and regression checks
    relay/                  Relay order destinations, source swaps and Lab replay
  helpers/                  Fixture loaders, assertions and offline provider verification
  mocks/                    Shared dependency mocks
  fixtures/
    onchain/<protocol>/     Source transactions grouped by bridge, with one manifest
    providers/<provider>/   Quotes, original responses and provider-specific data
    providers/history/     Shared history index and provenance
    quotes/                 Captured quote-to-transaction cases
    quotes/routes/          Route-specific quotes and their original evidence
    regressions/            Reported paths, successful history and discovered cases
    coverage/               Baseline, candidate inventory, shared report and discovery query
    evidence/imports/       Import notes, RPC snapshots and previous review reports
```

## Adding a case

- Extend the existing protocol/bridge fixture or behavior suite. Do not create a
  new directory or test filename for each capture date.
- Keep calldata, token amounts, addresses and expected values from the original
  evidence. Preserve provenance fields and original provider-response bytes.
- Update `fixtures/onchain/manifest.json` when adding onchain cases. Shared
  loaders live in `helpers/fixtures.js`.
- Provider history `responseFile` paths are relative to `fixtures/providers/`.
  SHA-256 values identify the unchanged provider responses.
- Relay validation replay belongs in `fixtures/providers/relay/lab.json` and
  `calldata/relay/lab.test.js`. Include the selected input, complete transaction
  and `order_data`. Backend failures without a transaction do not belong in this
  calldata replay set. Explicitly constructed invalid orders remain useful
  rejection tests.
- Import notes and old review reports explain where data came from; they are
  not current SDK pass/fail results.
- LI.FI destination mismatches belong in `fixtures/providers/lifi/destination-mismatches.json`
  and `calldata/lifi-destination.test.js`. Keep the original build request and
  complete response; an unexpected recipient alone does not identify Smart Deposits.

## Running relevant tests

The standard test configuration imports `dist/`. Build the SDK first:

```sh
yarn build
NODE_OPTIONS=--experimental-vm-modules yarn exec jest --runInBand --watchman=false tests/calldata/relay
NODE_OPTIONS=--experimental-vm-modules yarn exec jest --runInBand --watchman=false tests/calldata/refund-recipients.test.js
```

The existing `yarn test:bridge-calldata` command runs the calldata suites. Tests
use captured fixtures and mocked API responses; they do not submit transactions
or request fresh provider quotes.
