# 补充 CSV 的完整测试单元

来源：`/Users/shuang/Downloads/New_Query_2026_11_03 (1).csv`。源文件 SHA-256 与筛选记录见 `manifest.json`。

200 条记录首次保留 57 个 calldata 单元，本次取回缺失服务商响应后再保留 124 个历史订单单元，随后补齐 10 个解析遗漏样本，共 191 个完整数据单元；其中 4 个记录当前校验的明确拒绝。剩余 9 条未纳入。Downloads 中的源文件保持不变。

- Across：53 个。
- LI.FI Intents：7 个。
- LI.FI Mayan Swift：2 个。
- Mayan FastMCTP：3 个。
- Socket Eco：1 个。
- Socket OFT：1 个。

每个单元保留源链交易、原历史报价、固定五字段预期及预期来源说明。源 token 身份与历史详情核对，精确源金额按各自 expectedEvidence 从独立 ABI/raw 或服务商原文取得；目标最低量按签名中的约束计算，不使用报价展示金额或实际到账量代替。Across 深入解析已识别的目标链 handler 提现、费用和最终转账；Mayan 原生币最低量从 8 位规范化单位换成 18 位 raw 单位。Receiver 同时核对源交易的明确参数与 Rabby 同地址跨链意图，不假定所有协议默认发给源发送人。

原批 57/57 与补齐的 10/10 五字段精确回放通过。合并后 142/142 个 calldata/RPC 与报价构建样本离线回放通过；另新增 124 个服务商历史响应单元，120 个五字段回放成功，4 个按已知边界拒绝；原有 6 个服务商报价流程样本本次未重跑。未运行完整 yarn test、构建、TS、ESLint 或循环依赖检查。

新样本暴露并修复 BSC Across 的白名单误拒：配置中的外层 periphery 与内层 SpokePool 不同。内层固定使用官方列出的 `0x4e8e101924ede233c13e2d8622dc8aed2872d505`，并保留替换为其他地址时拒绝的回归断言。地址依据：[Across 官方合约清单](https://exclusive.docs.across.to/chains-and-contracts)。

累计 272 个完整数据单元，成功覆盖 18/27 类桥、原 26/46 条函数路径，仍缺 9 类桥和 20 条原函数路径。本批新增覆盖 Mayan FastMCTP 的 `swapAndForwardEth / createOrder`。如果包含此前发现的两条额外函数，覆盖为 28/48。逐桥、逐函数结果见 `coverage.json`。

尚无完整单元的桥类型：

- LI.FI：celercircle、celercirclefast、gnosis、paxos、polygon、polymer。
- Socket：arbitrum-native、polygon-native、robinhood-native。

覆盖统计只计有交易、明确五字段预期的完整单元；未覆盖不等于协议没有解析能力。

服务商补录来源、拒绝原因及历史关联边界见 `../providers/history-20261103/README.md`。
