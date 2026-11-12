# 原始请求与报价构建交易测试集

来源：`bridge-valid-quotes-20261103-214141.json` 与 `bridge-valid-quotes-20261103-214730.json`，各源文件 SHA-256 见 `manifest.json`。

两份导出共 114 条，去重后保留 35 个完整单元：LI.FI Mayan MCTP 13、Intents 11、Mayan Swift 7、Polymer Standard 4。第一份保留 28 个，第二份新增 7 个。其余 79 条未作为测试数据保存：24 条没有 build tx、10 条缺 RPC 回放、30 条 Relay 缺同一订单原文、15 条 LayerSwap 缺订单响应。用户 Downloads 中的原始导出文件保持作为来源。

每个单元都保留原始 `request`、`quote`、`tx` 和五个固定 `expected`。源 token、源 raw 金额、目标 token、Receiver 来自本地请求；原生币标识归一为零地址，Receiver 按 Rabby 同地址意图设置。最低量使用独立的 ABI 字段和协议计算规则固化，不调用待测解析器生成预期。Mayan 原生币订单将规范化的 8 位最低量转换为 18 位 raw 单位；其他路由按其费率、费用或 multiplier 约束换算。

`quoteBenchmark` 单独保留 hex 报价转成的精确 raw 金额和滑点下限，用来区分“校验要求的下限”与“calldata 实际约束的精确最低量”。不使用可能超出 JS 安全整数范围的展示 number 作为金额依据。

这 35 个单元已加入 `loadBridgeCases()`、五字段精确断言及 fixture 完整性检查。定向导入回放 35/35 的五字段全部匹配；本次未运行完整 Jest、构建或类型检查。

再合并其他批次及 `routes/` 的 8 个单元后，共 348 个完整数据单元（341 个正常通过、7 个预期拒绝）。本目录保留原 35 个；报价类 loader 总计 43 个，按各自请求的滑点核对阈值，新增 Across 目标 DEX 负例使用 5%。

原 27 类桥、46 条函数均有正例，累计观测清单扩至 29 类桥、53 条函数。列表见 `../coverage/report.json`；已知拒绝不计入成功覆盖，观测清单也不代表所有可达模式。最新解析说明见 `routes/README.md`。
