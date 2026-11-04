# 完整的 Bridge 解析测试单元

每个解析单元必须同时保留源交易 `tx` 和五个明确的 `expected`：

- `sourceToken`：源 Token ID。
- `sourceAmount`：源金额，十进制 raw 字符串。
- `outputToken`：目标 Token ID，原生币使用零地址。
- `minOutputAmount`：目标最低量，十进制 raw 字符串。
- `receiver`：目标最终收款人。

正常解析单元对五个字段逐项精确断言，不使用“字段存在才比较”、金额只大于零，或从待测解析器输出生成预期。

已知拒绝样本单独检查拒绝原因，不计入解析成功。

当前共 348 个不重复的完整单元，覆盖 29 类 Bridge（341 个正常通过、7 个预期拒绝）：

- 本目录 6 个历史单元：LI.FI Superset、Mayan FastMCTP、Socket CCIP、Gnosis Native、OFT、swaps-xyz，各 1 个。
- `../providers/` 151 个服务商单元：原有 6 个，以及补录的 145 个历史订单单元（140 个五字段成功回放、5 个明确拒绝样本）。
- `../onchain-20261103/` 新 CSV 补充的 34 个完整单元，预期由独立 ABI 字段及协议规则建立。
- `../onchain-20261103-extra/` 补充 CSV 的 57 个完整单元，包含独立建立的五字段预期。
- `../onchain-20261103-gaps/` 补齐的 10 个样本：Across 8、Socket OFT 1、Mayan FastMCTP 1。
- `../quotes-20261103/` 两份导出的原始请求、报价和 build tx 中保留的 35 个完整单元。
- `../completed-20261103/` 已完成交易 CSV 补入的 28 个 calldata/RPC 单元；同批 20 个服务商单元计入上面的 `../providers/`。
- `../coverage-completion-20261103/` 从原始 CSV 补回的 19 个 calldata/RPC 单元；同批 1 个 Socket 服务商单元计入上面的 `../providers/`，补齐此前未覆盖的 20 条函数路径。
- `../route-discovery-20261104/` 8 个真实报价单元：6 个正常通过、2 个预期拒绝；含 14 个额外可信 RPC 响应。

来源为四份 CSV、两份原始请求与报价构建导出，以及直接服务商响应和新增路径报价。11 月 2 日 CSV 曾移除的 118 个不完整单元中，已取回并完善 20 个，剩余 98 个仍未纳入；1 笔完整 LayerSwap 交易去重后保留在服务商 fixture，本目录本身保留 6 笔。所有来源累计 348 个完整单元，源文件 SHA-256 和各批次计数见 `manifest.json`。Frax 唯一缺报价记录继续排除。

早期历史样本使用原导出中精确保留的源金额和历史目标 token；后续样本按各自 expectedEvidence，使用独立 ABI/raw 读取、合约状态或服务商原文建立固定预期。最低量使用协议约束，不使用实际到账量代替。Receiver 明确按 Rabby 同地址跨链意图检查，不表示所有桥都默认发给源发送人。服务商原始报价单元保留签前绑定；历史查询单元核对已上链交易关联，不声称完整还原了原始签前报价。

`contract-state.json` 只保留当前完整单元需要的只读响应。它们查询的是记录时 `latest` 状态，不能视为原交易区块状态的证明。测试离线回放，不请求服务商或 RPC。服务商历史补录的实际 HTTP 仅在本轮取数时执行；原始响应保存在 `../providers/history-20261103/`。

移除样本不删除协议解析实现。Across 历史 calldata 单元仍为 74 个，另有 3 个新增报价单元（含 1 个拒绝）。原 27 类桥、46 条函数已覆盖，累计观测清单为 29 类桥、53 条函数，每条都有正常通过单元；不是全部可达分支的上限。最新说明见 `../route-discovery-20261104/README.md`，逐桥与逐函数见该目录的 `coverage.json`。

历史补录中的已知拒绝样本不计入成功覆盖。Relay/Socket 历史记录关联不表示本次新增了 SDK 签前查询接口；详细边界见 `../providers/history-20261103/README.md`。
