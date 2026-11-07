import { GATEWAY_AI_ENABLED, GATEWAY_BASE_URL } from "@/constant/env";

/**
 * 统一出口模式（分发构建）下，浏览器不再持有上游地址和密钥：
 * - 地址一律改写成网关地址，由网关按需转发到真实上游；
 * - 请求头不带 Authorization，密钥由网关注入，客户端全程看不到。
 *
 * 本地开发不开启该模式，一切照旧，仍可直连自己配置的通道调试。
 */
export function resolveAiBaseUrl(baseUrl: string) {
    return GATEWAY_AI_ENABLED ? GATEWAY_BASE_URL : baseUrl;
}

/** 统一出口模式返回空串，调用方据此决定是否发送鉴权头。 */
export function resolveAiApiKey(apiKey: string) {
    // 阶段一（同事自带 key）：这里把 key 原样送给网关，网关没有服务端 key 时透传给上游。
    // 阶段二（统一出 key）：网关配上 UPSTREAM_KEY 后会覆盖这个头，前端无需重新发包。
    return apiKey;
}

/** Gemini 协议的网关基址（含 /v1beta），空串表示不走网关。 */
export const GATEWAY_GEMINI_BASE = GATEWAY_AI_ENABLED ? `${GATEWAY_BASE_URL}/v1beta` : "";

/** 统一出口模式下「没有 key 也算配置好了」，由网关持有 key。 */
export function isAiKeyConfigured(apiKey: string) {
    return GATEWAY_AI_ENABLED || Boolean(apiKey.trim());
}
