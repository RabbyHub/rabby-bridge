# 2026-11-03 补充测试集

`New_Query_2026_11_03.csv` 含 112 笔真实交易，涉及 14 类桥、22 条函数路径。保留 34 个能独立建立完整五字段预期的单元，另 78 笔不作为完整测试单元加入。

新增完整单元：Across 9、Socket Eco 5、Mayan FastMCTP 1、LI.FI Intents 10、Socket OP Stack 1、LI.FI Polymer Standard 8。

每个单元保留原始 `tx`、历史 `quote`、五字段固定 `expected` 及 `expectedEvidence`。源金额按导出十进制和 token 精度转换，并与独立 ABI 字段读取核对，避免丢失 raw 精度。目标最低量由 ABI 明确约束的金额、费用和倍数推导；Receiver 取明确目标转账/订单参数，再与 Rabby 同地址意图核对。预期生成未调用 SDK 待测解析器，也未把报价预计到账或实际到账当作最低量。

字段预期固化后，才使用 SDK 做导入回放。当前全部 46 个完整单元（原有 12 + 新增 34）的五字段回放匹配；本次未运行 Jest、完整构建或类型检查。

此次样本暴露并修复了 Across 到 Ink 解包路径的 WETH 映射缺失：Ink `57073` 的 WETH9 为 `0x4200000000000000000000000000000000000006`。依据：https://docs.inkonchain.com/useful-information/ink-contracts 。

`manifest.json` 记录来源 SHA-256 和 78 个未纳入单元的记录及原因。LayerSwap 已尝试直接查询 10 笔订单，8 个返回 403，2 个 TLS 超时，因此没有用新报价代替历史订单。其余未纳入原因包括缺独立订单/费用或 token 映射证据、源金额精度不一致，以及尚未独立建立完整参考预期。

`coverage.json` 区分交易样本出现与完整单元覆盖。合并现有单元后，原 27 类桥中 18 类有交易样本、16 类有完整单元；原 46 条函数路径中 25 条有交易样本、17 条有完整单元。新 CSV 还新增 Across depositNative 和 Mayan swapAndForwardEth → bridge 两条函数路径，扩展后的 48 条中，27 条有交易样本、19 条有完整单元。
