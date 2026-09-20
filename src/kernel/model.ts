/**
 * 会话内单条 assistant 消息的归一化内存模型。
 *
 * v1 来自 `message.updated` 事件（`info.tokens.{input,output,reasoning,cache}`）；
 * v2 来自 `SessionMessageAssistant.tokens`（`{input,output,reasoning,cache:{read,write}}`）。
 * 两者在各自的 adapter 中折叠为本类型，后续所有聚合逻辑只认这一份结构。
 */

export interface TokenMessage {
  id: string
  sessionID: string
  providerID: string
  modelID: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
  cost: number
}
