# 实际可达路径补查与解析补齐

> 以下回放统计记录的是移除 RPC 前的结果。当前实现已移除 RPC；依赖链上状态的目标字段保持未验证。ETH/WETH 样本现在仅标记目标币未验证，原 `to_token` 拒绝原因保留为历史记录。

✅ 原 27 类桥、46 条函数路径都有成功样本；累计观测清单现为 **29 类桥、53 条函数路径**。这不是全部潜在路径的上限。

本次增加 8 个真实报价测试单元：6 个五字段匹配，2 个按预期拒绝。累计 **348 个单元：341 个正常通过、7 个预期拒绝，无意外失败**。拒绝样本、M0 纯结构测试均不计入成功覆盖。

## 旧清单为什么会漏

- **桥类型不是固定名单。** 当前 后端 LI.FI 使用排除名单，未知 `step.tool` 仍能返回；Socket 也按排除 provider 筛选。两端前端没有额外的 27 类桥白名单。
- **同一函数有不同执行分支。** Across `deposit` 可直转，也可通过 message 做目标 swap；失败还可能退另一种币。只统计函数名看不到这些差异。
- **已有样本未登记。** 原数据中 Mayan `forwardERC20 / bridge` 已有完整单元，旧 48 条清单遗漏了它，现已补登记。
- **收费改变入口。** 两端均有零应用费条件，不能因旧样本都走 `swapAndStart...` 就排除 `startBridgeTokensVia...`。本次取得 Celer 直接入口真实报价。

依据是当前 后端 `main/bridge/{lifi,socket,across,mayan,relay}.py`、两端 Bridge 调用、SDK 链集合及服务商元数据。代码位置、链对示例、探测记录见 [reachability.json](reachability.json)。元数据只是候选；一次报价失败不能证明路径不可达。

## 已补齐的方式

以下 LI.FI 函数共享 `BridgeData`。**源币/源量**：直接入口取 `sendingAssetId / minAmount`；有源 swap 时取 `SwapData` 中实际向用户收取的币和 `fromAmount`，与中间桥币、桥量分开。

### ✅ LI.FI MegaETH

函数：`startBridgeTokensViaMegaETHBridge(BridgeData, MegaETHData)`、`swapAndStartBridgeTokensViaMegaETHBridge(BridgeData, SwapData[], MegaETHData)`。

`MegaETHData = (address assetIdOnL2, uint32 l2Gas, bool requiresDepositTo)`。

- **源币/源量**：公共输入规则。
- **目标币**：原生币路径为原生币；普通 ERC20 路径为 `assetIdOnL2`。
- **最低量/Receiver**：桥接 `minAmount / BridgeData.receiver`；实际目标链固定为 4326。
- `requiresDepositTo=true` 的自定义 ERC20 桥不使用 `assetIdOnL2` 决定远端币，保持目标币未解析。

已有真实原生币 `swapAndStart...` 样本；其他结构支持不等于已取得真实覆盖。

### ✅ LI.FI Centrifuge

函数：`startBridgeTokensViaCentrifuge(BridgeData, CentrifugeData)`、`swapAndStartBridgeTokensViaCentrifuge(BridgeData, SwapData[], CentrifugeData)`。

`CentrifugeData = (uint256 nativeFee, address refundRecipient)`。

- **源币/源量**：公共输入规则。
- **目标币**：可信源 TokenBridge 的 `spoke.shareTokenDetails(源桥币)` 得到 `poolId / shareClassId`，目标 Spoke 的 `shareToken(poolId, shareClassId)` 得到目标币。先核验源注册、链 ID 映射及 facet 的 TokenBridge 身份。
- **最低量/Receiver**：桥接 share 的原始金额、`BridgeData.receiver`；同地址意图下也核验 `refundRecipient`。

真实样本为 Ethereum→Base。目前仅启用已核实的 Ethereum/Base 映射，采用部署版 Spoke getter，没有混用 GitHub 新版本 ABI。

### ✅ Across：直接 ETH/WETH 区别

函数仍为既有 `depositNative / deposit / swapAndBridge`。

- **源币/源量**：既有存款参数；原生桥接额与其他 value 费用分开。
- **目标币**：空 message、输出为包装币时，目标 SpokePool 给 EOA/EIP-7702 地址交付原生币，给普通合约交付包装币。新增可信 RPC `getCode` 判定；缺少能力则拒绝。
- **最低量/Receiver**：源存款 `outputAmount / recipient`。

真实样本验证 EOA 得到 ETH，定向断言覆盖 EIP-7702、普通合约及缺失/异常 code。已有 Handler 显式 unwrap 继续按消息语义处理。

### ✅ Mayan FASTMCTP：补样本并修复最低量

当前 后端仅打开 FASTMCTP。新增 `swapAndForwardERC20 / bridge` 样本；内层参数：

`bridge(tokenIn, amountIn, redeemFee, circleMaxFee, gasDrop, destAddr, destDomain, referrerAddress, referrerBps, payloadType, minFinalityThreshold, customPayload)`。

- **源币/源量**：Forwarder 外层 `tokenIn / amountIn`，不是中间 USDC。
- **目标币/Receiver**：`destDomain` 对应目标链的规范 USDC、`destAddr`。
- **最低量**：`amountIn` 或源 swap 保证的 `minMiddleAmount`，减 `redeemFee / circleMaxFee` 后，再减推荐费和目标协议费上限 100 bps。

旧解析漏扣后两项，已修复。两个旧预期独立纠正为 **95824→94626**、**1022391→1009611**，未放宽比较。结果是保守协议下限，若低于用户滑点要求，高层应拒绝，不能换成报价数字。

本样本使用真实报价和真实源 swap 数据，按官方 SDK ABI **本地编码**源交易；不是历史上链交易，也不是服务商 HTTP build 响应。自定义后续 payload 仍保持拒绝。

### ⚠️ LI.FI M0：结构能取齐，尚无完整真实报价

函数：`startBridgeTokensViaM0(BridgeData, M0Data)`、`swapAndStartBridgeTokensViaM0(BridgeData, SwapData[], M0Data)`。

`M0Data = (bytes32 receiverAddress, address refundRecipient, address orderOwner, bytes32 tokenOut, bytes32 solver, uint128 amountOut, uint32 fillDeadline)`。

**源币/源量**取公共输入；**目标币/最低量/Receiver**取 `tokenOut / amountOut / receiverAddress`。源 swap 正滑点只会提高输出要求。核验 receiver 与 BridgeData 一致，并按本项目同地址意图核验退款地址和订单 owner，防止取消/退款转给别人。

已补解析及结构/篡改断言，但没有可用真实报价，部署及真实交易覆盖仍待确认；不计入 29 类桥。没有新增过期检查。

## 仍无法按单一五字段结果放行

- **AllBridge**：已补 `startBridgeTokensViaAllBridge / swapAndStart...` 部分解析。参数 `recipient / receiveToken` 明确目标币和 Receiver；源输入也可取。但目标量由目标池兑换状态决定，源签名没有最低量。[官方 FAQ](https://docs-core.allbridge.io/product/faq/how-to-transfer-assets) 说明 minimum receive 具有概率性。多请求报价不能变成链上保证，当前高层拒绝。
- **Garden**：已补 `startBridgeTokensViaGarden / swapAndStart...` 源输入、`secretHash` 关联标识。源 HTLC 的 `redeemer / refundAddress / timelock / secretHash` 没绑定完整目标条件；BridgeData 事件字段不是 HTLC 保证。需完整服务商订单逐项关联；尚未确认可用签前接口，不能假设 secretHash 就是订单哈希，当前高层拒绝。
- **Across 目标链 DEX**：真实 USDC→AERO `deposit` 的 message 有 AllowanceHolder `exec`→Settler `execute`，成功可得至少 **147467013112760530532 raw AERO**；失败则向同一用户退 **99969945 raw USDC**。需验证 Settler、费用、drain，并引入成功/fallback 结果校验政策；当前保留 `unsupported destination call` 负例，不能宣称保证收到 AERO。
- **LI.FI Intents 目标调用**：当前 后端 `allowDestinationCall=true`，单个顶层 step 不排除内部目标 swap。可以深解 `dstCallSwapData`，但须核实 ReceiverOIF、Executor、outputSettler 身份及 DEX 最低量、最终收款人和 fallback。当前仍拒绝任意目标执行；本次取得的 Intents 报价不含真实目标 swap，不冒充覆盖。
- **SmartDeposits**：元数据有 SDK 支持的 EVM 链对，未取得完整源交易。需 deposit factory/config 或可验证订单确定目标条件；普通转账不能推断跨链目标。
- **Frax**：已有 OFT→Fraxtal hub→目标 peer 解析；原数据记录缺报价，本次也未取得可用报价，仍缺完整真实单元。
- **Relay 包装调用**：历史 `multicall / transferAndMulticall` 记录回放不等于签前绑定。当前签前 verifier 仅支持直接 depository；包装调用还需绑定内层存款与订单哈希，不能凭历史测试宣称签前完整支持。

## 当前不需要扩展

- 当前 后端禁用的 LI.FI 路由不按候选支持；含 `polymer` fast（旧历史样本保留），不影响启用的 `polymerStandard`。
- Mayan 聚合器已关闭 Swift/MCTP/Wormhole/Shuttle/gasless；LI.FI 下的 Mayan 分支另算。
- `mayanWH / chainflip / unit / cctp / hyperliquidSA / hyperliquidNative` 元数据没有当前 SDK 普通 EVM 源/目标链对，本次不展开；HyperCore 专用流程需另查。
- 不按 ABI 虚构 bridge×swap 全组合，也不把一次返回 RFQ 当作 native bridge 永远不可达。

## 测试与接入

[cases.json](cases.json) 保存 8 个完整请求/报价/源交易及固定预期；[coverage.json](coverage.json) 列出每类桥、每个已观测函数及待覆盖候选；[replay-results.json](replay-results.json) 保存 348 单元回放统计；[manifest.json](manifest.json) 保存 HTTP SHA-256、源码依据及预期修正。

新增负例分别是 Socket 报价要 ETH、WETH Gateway 实际给 WETH，以及 Across 目标 swap 的另一种币 fallback。负例只检查相应拒绝，不算五字段成功。

新增 13 个 eth_call、1 个 eth_getCode 已合入公共离线回放；是抓取时 latest，不是历史区块证明。取数直连服务商，同一服务商串行、间隔至少 2.5 秒、复用缓存并处理限流；回放不发 HTTP。未签名、上链或修改当前 后端。

Across 直接原生币判定已暂缓，当前 SDK 不提供 RPC 接入。需要收款地址代码才能判断的目标币保持未验证，详见 [SDK 接入](../../../src/calldata/README.md)。

执行了五字段/预期拒绝回放、定向边界断言和语法检查；未运行完整 `yarn test`、TS、ESLint、循环依赖或设备检查。尚无真实样本的候选不算覆盖，未知目标执行仍拒绝。
