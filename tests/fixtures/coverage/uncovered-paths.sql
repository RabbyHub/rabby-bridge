-- MySQL / TiDB. Identify exact function paths locally after downloading candidates.
-- Returns at most 1000 transactions in total.
-- Check create_at index usage with ordinary EXPLAIN before production use.
-- The timeout hint takes effect when supported and preserved by the client.
SELECT /*+ MAX_EXECUTION_TIME(5000) */
    tx_id AS from_tx_id,
    from_chain_id
FROM bridge_history
WHERE create_at >= UNIX_TIMESTAMP(NOW()) - 8 * 3600
  AND (finished_at IS NOT NULL OR fee_token_id IS NOT NULL)
  AND tx_id IS NOT NULL
  AND tx_id <> ''
  AND user_addr NOT IN (
      '0x9e2d651db0c4ae178545536828b042930a3afce4',
      '0x9899f62ecf16b70bffc88677023026c47e48c218'
  )
  AND (
      (
          aggregator_id = 'lifi'
          AND bridge_id IN (
              'celercirclefast',
              'gnosis',
              'layerswap',
              'lifiIntents',
              'paxos',
              'polygon',
              'polymerStandard',
              'superset',
              'megaeth',
              'centrifuge',
              'frax',
              'm0',
              'mayan',
              'mayanMCTP'
          )
      )
      OR (
          aggregator_id = 'socket'
          AND bridge_id IN (
              'arbitrum-native',
              'eco',
              'gnosis-native',
              'oft',
              'polygon-native',
              'robinhood-native',
              'swaps-xyz'
          )
      )
      OR (aggregator_id = 'across' AND bridge_id = 'across')
  )
ORDER BY create_at DESC
LIMIT 1000;
