# 补齐剩余 20 条函数路径

本文记录该批次完成时的快照。后续解析修正、累计计数及候选缺口见 [最新路径补查](../route-discovery-20261104/README.md)；本目录 `coverage.json` 已同步当前累计数据。

从 `New_Query_2026_11_02.csv` 补回此前未纳入的 20 个代表样本，全部通过五字段精确回放。没有新增解析器实现，也没有放宽校验；此前的缺口是固定预期、RPC 和服务商原文没有补齐。

累计 340 个完整单元：335 个正常通过、5 个既有预期拒绝。成功覆盖 27/27 个桥类型、原 46/46 条函数路径；包含此前额外发现的两条函数，扩展口径为 48/48。每条路径至少有一个正常通过的完整单元，不表示穷举所有链、token 或参数组合。

## 本批 20 条路径

行标识均来自原 CSV，包含表头行。以下各项均通过；完整五字段预期、源交易哈希及来源见 `path-results.json`。

- LI.FI / celercircle：`swapAndStartBridgeTokensViaCelerCircleBridge`，27。
- LI.FI / celercirclefast：`swapAndStartBridgeTokensViaCelerCircleBridge`，32。
- LI.FI / gnosis：`swapAndStartBridgeTokensViaGnosisBridge`，48。
- LI.FI / paxos：`swapAndStartBridgeTokensViaPaxosTransit`，81。
- LI.FI / polygon：`swapAndStartBridgeTokensViaPolygonBridge`，86。
- LI.FI / polymer：`swapAndStartBridgeTokensViaPolymerCCTP`，93。
- Mayan / FASTMCTP：`swapAndForwardERC20 / createOrder`，44。
- Socket / arbitrum-native：`bridge / outboundTransfer`，7。
- Socket / arbitrum-native：`bridge / createRetryableTicket`，10。
- Socket / arbitrum-native：`swapAndBridge / outboundTransfer`，11。
- Socket / ccip：`bridge / ccipSend`，13。
- Socket / cctp-v2-slow：`swapAndBridge / depositForBurn`，23。
- Socket / native-op-stack：`bridge / depositERC20To`，71。
- Socket / native-op-stack：`swapAndBridge / depositERC20To`，73。
- Socket / native-op-stack：`bridge / depositETHTo`，75。
- Socket / oft：`swapAndBridge / send`，76。
- Socket / oft：`bridge / sendFrom`，77。
- Socket / polygon-native：`bridge / depositERC20ForUser`，88。
- Socket / polygon-native：`swapAndBridge / depositERC20ForUser`，90。
- Socket / robinhood-native：`bridge / createRetryableTicket`，113。

## 固定预期与真实响应

19 个单元使用 calldata 与可信链状态；1 个 Socket CCTP slow 单元使用服务商历史订单关联。预期由独立 Python ABI 字段读取、协议规则与原始 RPC/服务商记录建立，不从待测 SDK 输出生成。金额使用 raw 整数字符串，逐字段精确比较，不用实际到账量替代最低量。

- LI.FI：源输入读取 `requiresDeposit` 的 swap 金额；Celer 从 BridgeData.minAmount 扣除代理合约 `totalFee()[0]` 与 maxFee；Paxos 从签名 Quote 读取目标币、接收人并扣除费用；Polymer 扣除两项显式费用；Polygon 使用链上映射；Gnosis 的 DAI 路径映射为原生 xDAI。
- Mayan：读取 Forwarder 的 tokenIn/amountIn 及 FastMCTP 的 tokenOut、destAddr、amountOutMin；原生 POL 的规范化 8 位最低量换算成 18 位 raw 单位。
- Socket：读取 OpenRouter 输入与嵌套桥参数，按 flags 处理 swap 最低量的费用和金额替换；Arbitrum、CCIP、OFT 使用真实映射与精度响应，原生桥使用明确的收款人和金额参数。
- CSV 行标识 48、44、7、77 的历史展示源金额与 ABI 精确值有差异。固定预期使用独立读取的精确源金额，未放宽金额比较，也未改写原 CSV。

`contract-state.json` 保存 23 个真实 RPC 响应；按每秒最多一笔串行查询并复用缓存，BSC 超时后使用备用 RPC。费用和映射采用抓取时 `latest`，校验的是该记录状态下的解析结果，不宣称还原原交易区块的费用状态。

Socket CCTP slow 直接请求服务商 `GET /v3/swap/status?quoteId=...&includeQuoteDetails=true`，同时核对 calldata quoteId、两处源交易哈希及源输入条件。目标五字段来自原 `quoteDetails`，不使用 fulfilledAmount。HTTP 原文及 SHA-256 位于 `../providers/history-20261103/coverage-completion/` 和对应 fixture。历史关联仍是 `provider-record`，不能等同于签前交易哈希绑定。

## 回放结果

- 189 个 calldata/RPC 与原始报价构建单元全部通过。
- 145 个服务商历史单元：140 个正常通过、5 个既有预期拒绝。
- 原有 6 个直接服务商单元通过。
- 共 340 个单元，无意外失败；原有 320 个单元的签名字段及固定预期保持不变。
- 新增检查覆盖 Celer 缺费用 RPC、费用超出输入、OFT v1 远端路径的源合约被替换、Socket CCTP 服务商订单关联到其他源交易。普通 OFT 与 Stargate 分别按其实际映射机制验证，未把普通 OFT 错当成 Stargate。

完整结果见 `replay-results.json`，逐桥、逐函数覆盖见 `coverage.json`。测试只读取已保存响应，不发 HTTP。

未运行完整 `yarn test`、构建、TS、ESLint 或循环依赖检查。
