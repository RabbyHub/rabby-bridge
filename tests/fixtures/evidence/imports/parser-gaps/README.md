# 十笔遗漏样本的解析补齐

这 10 笔来自 `New_Query_2026_11_03 (1).csv`，均保留源交易和独立建立的五字段固定预期。它们是 10 笔样本，涉及同名函数的不同输入资产、Handler 和映射情况，并非 10 个新增函数 selector。

- Across 8 笔（CSV 行标识 14、28、38、44、62、68、69、197）：按目标链识别 HyperEVM / Robinhood 的 MulticallHandler；深入解析其余额替换、提现、费用及最终 drain。`swapAndBridge` 的原生币输入根据 `msg.value > 0` 识别，并要求它等于 `swapTokenAmount`；零 value 仍按 ERC20 输入解析。
- Socket OFT 1 笔（92）：通过 Stargate TokenMessaging 的 assetId 和远端实现确定 Soneium 原生 ETH；目标最低量按 shared decimals 舍入为 `97000000000000` raw。Socket 输出的原生币源标识统一为零地址。
- Mayan FastMCTP 1 笔（104）：现有解析器已经支持 ERC20 目标币；此前筛选仅覆盖原生目标币，遗漏了该样本。现补入 CHIP 的真实 `decimals() = 18` 响应，按订单的 8 位规范化 `amountOutMin` 换算为 `12895392494670000000000` raw。

预期由独立 Python ABI 字段读取、协议规则及保存的真实 RPC 响应建立，不从待测 SDK 的解析结果生成。CSV 38 的源展示金额存在 1 wei 差异，此处使用独立读取的 calldata / tx.value 精确 raw 值建立预期，没有放宽金额比较。

历史展示字段中的科学计数法只做等值十进制字符串转换，不通过浮点数，也不恢复已丢失精度或改变 expected/raw 值。

安全边界保持拒绝未知路径：Handler 按目标链限定；任意带 `withdraw` selector 的 token 不能当作包装原生币；OFT 仍验证资产登记和共享精度；Mayan 缺 decimals 响应时不能拿报价金额代填。

新增 10/10 与累计 142/142 个 calldata/RPC、报价构建样本的五字段精确回放均匹配；新增篡改检查覆盖原生币 value、原生币与包装币区别、错链 Handler、伪造包装币。124 个历史服务商单元也重新回放：120 个五字段成功，4 个已知拒绝保持原状。未运行完整 yarn test、构建、TS、ESLint 或循环依赖检查。

`contract-state.json` 是本次补录的 12 个真实读取：OFT 11 个、Mayan 1 个。Base / Soneium 使用记录的块高，Mayan decimals 使用记录时 latest，均不声明是原交易区块状态的证明；测试只读取本地回放。

实现身份依据：

- [Across 官方 SpokePoolPeriphery](https://github.com/across-protocol/contracts/blob/master/contracts/periphery/SpokePoolPeriphery.sol)：原生币 swap 分支及金额约束。
- [Across 官方部署表](https://github.com/across-protocol/contracts/blob/master/broadcast/deployed-addresses.json)：HyperEVM Handler 与 Robinhood SpokePool。
- [Sourcify Robinhood Handler](https://sourcify.dev/server/v2/contract/4663/0xa8ad2e87e2043711d8bec77e8bc3e2683c0ab6bd?fields=all)：运行时代码匹配；另与 RPC 的 eth_getCode 原文对照，确认是已验证的 MulticallHandler。完整响应保存在 `evidence/robinhood-handler-verification.json`。
- Robinhood 的包装原生币地址来自官方 SpokePool 的 `wrappedNativeToken()` 读取，原始响应保存在 `evidence/robinhood-wrapped-native.json`。

这 10 笔已从排除清单移入正常五字段解析测试。该 CSV 尚未纳入的 9 笔属于源金额预期数据差异；此前 4 笔服务商校验拒绝样本没有在本轮修改。
