# Offline provider evidence

The lightweight release does not expose `createBridgeProviderClient`,
`createBridgeFetchRequest`, provider transports or the `providerClient` parameter.
All quotes/builds use the existing backend APIs; SDK validation makes no extra
Relay, Socket or LayerSwap HTTP requests and no RPC requests.

Relay destination fields and Socket RFQ/ClaimExecutor receivers cannot be proven
from source calldata alone. They remain in `unverifiedFields` without reports
for these known local limitations; the SDK never substitutes the user's expected
receiver or backend display fields for verified fields. LayerSwap's signed receiver stays locally
checked, while its unavailable destination token/minimum is skipped.

The internal pure data readers in this directory are retained for offline fixture
regression only. They do not fetch data and are not exported from the package root.
Tests replay captured Relay order hashes, Socket historical transaction links and
LayerSwap records. This historical evidence is not a guarantee supplied by the
lightweight runtime. Restoring independent provider verification is a later change.
