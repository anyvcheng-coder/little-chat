import type { MessageUsage } from './api/types.js'

/**
 * deepseek-flash（DeepSeek-V4.1-Flash）的官方人民币定价，单位「元 / 百万 tokens」。
 * 2026-08-17 起改为峰谷定价，空闲时段价格为高峰时段的一半。
 * 缓存命中（cache_read）比未命中便宜 30 倍；写入缓存按未命中计费。
 */
const PRICE = {
  peak: { hit: 0.1, miss: 3, output: 9 },
  offPeak: { hit: 0.05, miss: 1.5, output: 4.5 },
} as const

/** 高峰时段：北京时间（UTC+8）周一至周五 9:00-12:00、14:00-18:00；其余（含周末）为空闲 */
export const isPeakTime = (at: number): boolean => {
  const beijing = new Date(at + 8 * 60 * 60 * 1000)
  const day = beijing.getUTCDay()
  if (day === 0 || day === 6) {
    return false
  }
  const hour = beijing.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** 按请求发生的时间估费：用量来自接口回传，价格随峰谷变化 */
export const estimateCost = (usage: MessageUsage, at: number): number => {
  const rate = isPeakTime(at) ? PRICE.peak : PRICE.offPeak
  return (
    ((usage.input_tokens + usage.cache_creation_input_tokens) * rate.miss +
      usage.cache_read_input_tokens * rate.hit +
      usage.output_tokens * rate.output) /
    1_000_000
  )
}

export const totalTokens = (usage: MessageUsage): number =>
  usage.input_tokens +
  usage.cache_creation_input_tokens +
  usage.cache_read_input_tokens +
  usage.output_tokens

/**
 * 请求体的 token 粗估，只用于在客户端裁剪上下文，不要求精确。
 * 中文约 1 字 1 token、ASCII 约 3 字符 1 token，整体偏保守（宁可高估）。
 */
export const estimateTokens = (text: string): number => {
  let wide = 0
  let narrow = 0
  for (const char of text) {
    // 每个字符至少有一个码元，codePointAt 不会返回 undefined
    if ((char.codePointAt(0) ?? 0) > 0xff) {
      wide += 1
    } else {
      narrow += 1
    }
  }
  return Math.ceil(wide * 0.9 + narrow / 3)
}

/** 1200 → 1.2k；小于 1000 原样显示 */
export const formatTokens = (count: number): string => {
  if (count < 1000) {
    return String(count)
  }
  const thousands = count / 1000
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}k`
}

/** 小额也保留有效数字：0.0064 元比 0.01 元更有参考价值 */
export const formatCost = (cost: number): string => {
  if (cost <= 0) {
    return '¥0'
  }
  if (cost < 0.0001) {
    return '<¥0.0001'
  }
  return `¥${cost >= 0.01 ? cost.toFixed(3) : cost.toFixed(4)}`
}
