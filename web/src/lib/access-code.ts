import { GATEWAY_BASE_URL } from "@/constant/env";

// 访问码只存在浏览器本地，用于向网关证明「这个人是谁」。
// 它是使用门槛，不是身份认证：码在网关侧校验，前端只是携带者。
export const ACCESS_CODE_KEY = "canvas-access-code";

export function readAccessCode(): string {
    try {
        return localStorage.getItem(ACCESS_CODE_KEY) || "";
    } catch {
        return "";
    }
}

export function saveAccessCode(code: string) {
    try {
        localStorage.setItem(ACCESS_CODE_KEY, code);
    } catch {
        // 隐私模式下写不进去，本次会话仍然可用
    }
}

export function clearAccessCode() {
    try {
        localStorage.removeItem(ACCESS_CODE_KEY);
    } catch {
        // 忽略
    }
}

// 网关地址归一化，用于判断某个请求是不是走网关。
function normalizeBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, "").toLowerCase();
}

// 只有发往网关的请求才需要带访问码，直连上游的请求不该看到它。
export function gatewayCodeHeader(baseUrl: string): Record<string, string> {
    if (normalizeBaseUrl(baseUrl) !== normalizeBaseUrl(GATEWAY_BASE_URL)) return {};
    const code = readAccessCode();
    return code ? { "x-canvas-code": code } : {};
}

type VerifyResult = { ok: boolean; codeRequired: boolean; caller?: string; error?: string };

export async function verifyAccessCode(code: string): Promise<VerifyResult> {
    try {
        const response = await fetch(`${GATEWAY_BASE_URL}/__verify`, {
            headers: code ? { "x-canvas-code": code } : {},
        });
        if (response.ok) {
            const data = (await response.json()) as { caller?: string; codeRequired?: boolean };
            return { ok: true, codeRequired: Boolean(data.codeRequired), caller: data.caller };
        }
        return { ok: false, codeRequired: true, error: "invalid" };
    } catch {
        return { ok: false, codeRequired: false, error: "unreachable" };
    }
}
