# 已完成交易测试集补充

来源：`bridge_history_completed_2026_11_03.csv`，48 笔交易；与已有 272 个单元均不重复。本批全部保留，导入后共 320 个完整单元：315 个正常通过、5 个预期拒绝。随后补齐的 20 条路径与当前累计进度见 `../coverage-completion-20261103/README.md`。完整单元均有源交易及五字段固定预期；拒绝用例单独标记，不计入正常成功覆盖。

本批 28 个 calldata/RPC 单元和 20 个服务商单元中，47 个五字段校验通过，1 个 LayerSwap 按严格最低量校验拒绝。原 CSV 未修改。`manifest.json` 保留源文件 SHA-256、CSV 行标识与交易哈希；行标识从 2 开始，包含表头行。

## 本批 11 条函数路径

- Across `deposit`：8/8 正常通过。
- Across `swapAndBridge`：4/4 正常通过。
- LI.FI Intents `swapAndStartBridgeTokensViaLiFiIntentEscrowV2`：1/1 正常通过。
- LI.FI LayerSwap `swapAndStartBridgeTokensViaLayerSwap`：3/4 正常通过，另 1 个预期拒绝。
- Relay `depositErc20`：6/6 正常通过。
- Relay `depositNative`：4/4 正常通过。
- Socket RFQ `swapAndBridge / receiveERC20`：6/6 正常通过。
- Socket OFT `bridge / send`：5/5 正常通过。
- Mayan FASTMCTP `swapAndForwardEth / createOrder`：7/7 正常通过。
- Mayan FASTMCTP `forwardERC20 / createOrder`：2/2 正常通过。
- Mayan FASTMCTP `forwardERC20 / bridge`：1/1 正常通过。

五字段为源 Token、源 raw 金额、目标 Token、目标 raw 最低量和最终 Receiver。最低量不是交易完成后的实际到账量。独立 ABI 读取、协议规则及服务商原文用于建立固定预期，不使用待测 SDK 输出生成 expected。来源和换算规则逐条保存在 `expectedEvidence` 中。

## 服务商与 RPC 补录

直连服务商取得 20 个成功响应：Relay 10、Socket 6、LayerSwap 4。每个服务商串行，Relay 至少间隔 31 秒，其余至少 2.5 秒，遇 429 退避。HTTP 原文位于 `../providers/history-20261103/completed/`，每条 fixture 记录 URL、获取时间与响应 SHA-256；查询索引见 `provider-fetch-index.json`。

本批新增 21 个 RPC 调用记录，其中包含 Stargate 的真实 `peers` revert，随后通过 TokenMessaging 资产登记、源端实现反查及远端实现读取确定目标原生 ETH。Mayan 的目标 USDT `decimals() = 6`，按 `min(decimals, 8)` 换算最低量。记录使用抓取时 `latest` 状态，不构成原交易区块的状态证明。

补齐了 Across 的 Avalanche Handler 与事件合约识别，按目标链限定地址；目标最低量从桥输出扣除显式费用，再读取最终 drain 收款人。事件字段不作为金额依据。Handler 的 Sourcify 运行时代码匹配响应，以及事件合约的浏览器已验证源码和 RPC bytecode 保存于 `evidence/`。新增检查拒绝错链或未知事件合约、携带 value 的事件调用；已有未知 Handler、伪造包装币、OFT 未登记资产等拒绝规则保持生效。

## 预期拒绝

CSV 行标识 30：LayerSwap 的字段齐全，但本次服务商响应的 `receive_amount = 214260000000000` raw、滑点 1%、输出量子 `10000000000`，对应最低要求为 `212110000000000`。实际响应的 `min_receive_amount = 212080000000000`，因此 SDK 返回 `min_receive`。历史详情展示的原报价为 `214220000000000`，与本次抓取响应不同；不能据此断言当时签名前也必然失败。保留该拒绝，未放宽校验。

历史 Relay/Socket 响应证明与已上链交易的服务商关联，不表示 SDK 新增了这些历史接口的签前校验。LayerSwap 按捕获响应的报价、滑点回放，不能完整还原原用户选中的报价。完整边界见 `../providers/history-20261103/README.md`。

## 累计覆盖进度

本批导入时成功覆盖 18/27 个桥类型、原 26/46 条函数路径；包含此前新增的两条函数，扩展口径为 28/48。本批 11 条路径都已在成功覆盖范围内，所以增加样本数量，没有增加已覆盖类型或函数路径。

当时缺少的 9 类桥及 20 条函数路径已在后续补齐，当前成功覆盖 27/27 类桥、原 46/46 条函数路径和扩展 48/48 条路径，逐项见 `coverage.json`；本批路径结果仍见 `path-results.json`。这是每条函数路径至少有一个完整成功单元的覆盖口径。

定向离线回放结果：170 个 calldata/RPC 与报价构建单元全部匹配，144 个历史服务商单元中 139 个正常通过、5 个预期拒绝，原有 6 个直接服务商单元通过。320 个单元的唯一性、签名字段、固定预期及服务商原文 SHA-256 均已核对。测试回放只读取本地响应，不请求服务商。

未运行完整 `yarn test`、构建、TS、ESLint 或循环依赖检查。
