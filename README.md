# rabby-bridge

Rabby Bridge SDK，提供跨链报价、交易构建、交易解析与本地校验能力。

## 主要流程

1. 通过当前 后端获取报价。
2. 根据用户选择构建交易并执行校验。
3. 返回可用交易或结构化错误，由业务侧处理后续流程。

## 主要接口

- `getQuote`：获取报价。
- `buildTx`：构建并校验交易。
- `getQuoteListWithTx`：获取包含可用交易的报价列表。
- `validateBridgeTx`：校验已有交易。

通过 `onError` 获取诊断信息，或使用 `toBridgeErrorReport` 转换错误。
上报时使用结构化诊断信息，避免附带完整交易或用户数据。
