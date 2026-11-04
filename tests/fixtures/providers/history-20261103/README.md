# 服务商历史订单响应补录

来源是 `New_Query_2026_11_03 (1).csv` 中先前缺订单响应的记录：Relay 50 笔、LayerSwap 37 笔、Socket 37 笔。只执行查询，不创建新报价或订单。每个服务商串行请求，Relay 请求至少间隔 31 秒，其他服务商至少间隔 2.5 秒；遇到 429 递增退避。

随后从 `bridge_history_completed_2026_11_03.csv` 再补入 20 笔：Relay 10、Socket 6、LayerSwap 4，响应原文放在 `completed/`。原始 CSV 的 Socket CCTP slow 再补入 1 笔，响应在 `coverage-completion/`。累计 145 个历史订单单元：140 个正常通过、5 个预期拒绝。来源与计数见 `manifest.json`；最新导入见 `../../coverage-completion-20261103/README.md`。

`cases.json` 保存源交易、历史详情、固定五字段预期、服务商响应来源与 SHA-256。各响应 JSON 保留 HTTP 原文；测试读取本地文件，不发 HTTP。原 CSV 缺少的 `tx.chainId` 由同一服务商记录的源链信息补齐，其他签名字段保持原值。

- Relay：请求 `GET https://api.relay.link/requests/v2?hash=...&includeOrderData=true`。原始输入来自服务商记录的 `currencyIn`；目标 token、最低量与 Receiver 来自完整 `orderData.output.payments[0]`。按官方 settlement SDK 0.0.152 的 EIP-712 schema 重算 orderId，并与服务商 `protocol.orderId` 比较。服务商记录中的原交易签名字段逐项与 CSV 交易对照；直接存款进一步检查 calldata orderId。Multicall 的外层 metadata request ID 与 orderId 不一定相同，其历史关联使用服务商 deposit-origin 记录。
- LayerSwap：请求 `GET https://api.layerswap.io/api/v2/explorer/{源交易哈希}`。同时匹配输入交易哈希与 calldata requestId 对应的 `swap.metadata.sequence_number`。最低量使用 `quote.min_receive_amount`。五字段回放调用现有 `verifyLayerSwapTx`，保持其全部校验。
- Socket：请求 `GET https://public-backend.socket.tech/v3/swap/status?quoteId=...&includeQuoteDetails=true`。同时核对源交易哈希、calldata quoteId、源 token/amount 和链信息。预期来自保存的 `quoteDetails.row.userQuoteParams` 与 `minOutputAmount`，不使用状态页中的实际到账量替代最低量。

历史关联与 SDK 签前校验的边界：Relay/Socket 的历史查询仅用于测试样本补录；本次没有把这些历史接口接入 SDK 的签前流程。Socket 历史记录提供服务商关联，无法重建原 `/quote` 响应对完整待签交易的绑定；Relay 的 Multicall 历史关联也不能视为 SDK 已支持该路由的签前订单校验。

已保留的已知拒绝样本会明确带 `expectedValidationError`，不计入五字段成功覆盖：CSV 行标识 64、75、160 的 LayerSwap 响应在服务商侧已舍入源金额，与 calldata 精确值不同；行标识 23 的 Socket Arc 路由当前校验尚不识别。保留这些样本用于记录拒绝边界，不把拒绝包装成五字段解析成功。

LayerSwap 历史回放使用捕获响应中 `quote.slippage`，不统一假设 1%。回放参数的输出报价使用同一响应的 `receive_amount`；这不代表原用户选中的报价仍可还原。已完成 CSV 行标识 30 的 `min_receive_amount` 为 `212080000000000` raw，低于该响应报价、滑点及精度推导的 `212110000000000`，所以保留 `min_receive` 拒绝。没有放宽 SDK 金额门槛或用实际到账量替代最低量。

最终请求数量、五字段回放数量、拒绝记录与逐路径覆盖见 `manifest.json`、`coverage.json`。本轮不运行完整 yarn test、构建、TS、ESLint 或循环依赖检查。

接口依据：[Relay Get Requests v2](https://docs.relay.link/references/api/get-requests-v2)、[Socket Get status](https://docs.socket.tech/api-reference/swap/get-status)。Relay 的旧历史接口有退役计划；此处固化的测试响应不依赖接口持续在线。
