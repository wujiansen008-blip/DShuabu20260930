// 网关核心：本地启动器（gateway.mjs）与云端函数（api/gateway.mjs）共用这一份逻辑。
// 职责：① 按访问码校验调用者 ② 把前端发来的 {{GUIDE:id}} 占位符替换成真实方法论 ③ 透明转发到上游。
import { Readable } from "node:stream";
import { commerceGuides } from "./prompts/commerce-guides.mjs";

const GUIDE_TOKEN = /\{\{GUIDE:([a-zA-Z0-9_-]+)\}\}/g;
const SKIP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);
const CODE_HEADER = "x-canvas-code";

// "code:小王,code2:小李" 或换行分隔；只写 code 时昵称等于 code。
export function parseAccessCodes(raw) {
    const map = new Map();
    for (const item of String(raw || "").split(/[\n,;]+/)) {
        const trimmed = item.trim();
        if (!trimmed) continue;
        const index = trimmed.indexOf(":");
        const code = (index > 0 ? trimmed.slice(0, index) : trimmed).trim();
        const name = (index > 0 ? trimmed.slice(index + 1) : "").trim() || code;
        if (code) map.set(code, name);
    }
    return map;
}

// 递归替换所有字符串里的占位符，避免直接改 JSON 文本导致转义损坏。
function injectGuides(value, used) {
    if (typeof value === "string") {
        return value.replace(GUIDE_TOKEN, (raw, id) => {
            const guide = commerceGuides[id];
            if (!guide) return raw;
            used.push(id);
            return guide;
        });
    }
    if (Array.isArray(value)) return value.map((item) => injectGuides(item, used));
    if (value && typeof value === "object") {
        for (const key of Object.keys(value)) value[key] = injectGuides(value[key], used);
        return value;
    }
    return value;
}

function applyCors(res) {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("access-control-allow-methods", "POST,GET,OPTIONS");
    res.setHeader("access-control-expose-headers", "*");
    res.setHeader("access-control-max-age", "86400");
}

function sendJson(res, status, payload) {
    applyCors(res);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(payload));
}

export function createGateway(options = {}) {
    const env = options.env || process.env;
    const upstreamBase = String(options.upstreamBase ?? env.UPSTREAM_BASE ?? "").replace(/\/+$/, "");
    const upstreamKey = String(options.upstreamKey ?? env.UPSTREAM_KEY ?? "");
    const legacyToken = String(options.legacyToken ?? env.GATEWAY_TOKEN ?? "");
    const accessCodes = parseAccessCodes(options.accessCodes ?? env.ACCESS_CODES ?? "");

    // 没配访问码时不校验：本地开发与首轮上线前的自测都靠这个默认值。
    if (legacyToken) accessCodes.set(legacyToken, "legacy-token");
    const requireCode = accessCodes.size > 0;

    const pluginRegistryUpstream = String(options.pluginRegistryUpstream ?? env.PLUGIN_REGISTRY_UPSTREAM ?? "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json");
    const pluginRegistryRoot = pluginRegistryUpstream.slice(0, pluginRegistryUpstream.lastIndexOf("/") + 1);
    const pluginRegistryPrefix = "/__official-plugins/";
    const registryCache = { at: 0, entries: null };

    // 每码用量：进程内累计，用于日志与 /__usage 查询。云端实例无状态，仅作观察线索。
    const usage = new Map();
    const touchUsage = (name, guideIds) => {
        const record = usage.get(name) || { requests: 0, guides: 0, lastAt: 0 };
        record.requests += 1;
        record.guides += guideIds.length ? 1 : 0;
        record.lastAt = Date.now();
        usage.set(name, record);
    };

    function originOf(req) {
        const host = req.headers.host || "127.0.0.1";
        const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
        return `${proto}://${host}`;
    }

    async function servePluginRegistry(res, origin, mount) {
        try {
            const now = Date.now();
            let manifest = registryCache.entries;
            if (!manifest || now - registryCache.at > 10 * 60 * 1000) {
                const upstream = await fetch(pluginRegistryUpstream, { headers: { accept: "application/json" } });
                if (!upstream.ok) {
                    sendJson(res, 502, { error: `插件源返回 ${upstream.status}` });
                    return;
                }
                const data = await upstream.json();
                const list = Array.isArray(data?.plugins) ? data.plugins : [];
                manifest = {
                    plugins: list.map((item) => {
                        if (!item || typeof item !== "object") return item;
                        const relative = typeof item.entry === "string" ? item.entry.replace(/^\.?\//, "") : "";
                        if (!relative || /^https?:\/\//i.test(relative)) return item;
                        const { entry, ...rest } = item;
                        return { ...rest, url: `${origin}${mount}${pluginRegistryPrefix}${relative}` };
                    }),
                };
                registryCache.entries = manifest;
                registryCache.at = now;
            }
            applyCors(res);
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify(manifest));
        } catch (error) {
            sendJson(res, 502, { error: `插件源不可用: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    async function proxyPluginAsset(res, pathname) {
        let relative = pathname.slice(pluginRegistryPrefix.length);
        try {
            relative = decodeURIComponent(relative);
        } catch {
            // 编码异常时保留原值，交给下游判断
        }
        if (!relative || relative.includes("..")) {
            sendJson(res, 400, { error: "非法的插件路径" });
            return;
        }
        try {
            const upstream = await fetch(`${pluginRegistryRoot}${relative}`);
            if (!upstream.ok) {
                sendJson(res, upstream.status, { error: `插件文件返回 ${upstream.status}` });
                return;
            }
            const buffer = Buffer.from(await upstream.arrayBuffer());
            applyCors(res);
            res.writeHead(200, { "content-type": upstream.headers.get("content-type") || "application/javascript; charset=utf-8", "cache-control": "public, max-age=600" });
            res.end(buffer);
        } catch (error) {
            sendJson(res, 502, { error: `插件文件获取失败: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    async function handle(req, res) {
        if (req.method === "OPTIONS") {
            applyCors(res);
            res.writeHead(204);
            res.end();
            return;
        }

        // 云端挂在 /api 下（Vercel 函数路径），本地直连根路径。去掉挂载前缀后逻辑完全一致。
        let path = req.url || "/";
        let mount = "";
        if (path === "/api" || path.startsWith("/api/")) {
            mount = "/api";
            path = path.slice(mount.length) || "/";
        }

        const requestUrl = new URL(path, originOf(req));

        // 健康检查与插件源不需要访问码，也不依赖上游 AI 配置。
        if (req.method === "GET" && requestUrl.pathname === "/__health") {
            sendJson(res, 200, { ok: true, upstream: Boolean(upstreamBase), codeRequired: requireCode, guides: Object.keys(commerceGuides) });
            return;
        }
        if (req.method === "GET" && requestUrl.pathname === "/__official-plugins.json") {
            await servePluginRegistry(res, requestUrl.origin, mount);
            return;
        }
        // 校验端点：前端进门时确认这串码是否有效，不消耗算力也不碰上游。
        if (req.method === "GET" && requestUrl.pathname === "/__verify") {
            if (!requireCode) {
                sendJson(res, 200, { ok: true, caller: "", codeRequired: false });
                return;
            }
            const provided = String(req.headers[CODE_HEADER] || req.headers["x-canvas-token"] || "").trim();
            const name = accessCodes.get(provided);
            if (!name) {
                sendJson(res, 401, { ok: false, error: "访问码无效或已停用", code: "invalid_code" });
                return;
            }
            sendJson(res, 200, { ok: true, caller: name, codeRequired: true });
            return;
        }
        if (req.method === "GET" && requestUrl.pathname.startsWith(pluginRegistryPrefix)) {
            await proxyPluginAsset(res, requestUrl.pathname);
            return;
        }

        // 一人一码：先认人，再花算力。
        let caller = "";
        if (requireCode) {
            const provided = String(req.headers[CODE_HEADER] || req.headers["x-canvas-token"] || "").trim();
            if (!provided) {
                sendJson(res, 401, { error: "缺少访问码，请在页面中填写邀请码", code: "missing_code" });
                return;
            }
            const name = accessCodes.get(provided);
            if (!name) {
                sendJson(res, 401, { error: "访问码无效或已停用", code: "invalid_code" });
                return;
            }
            caller = name;
        }

        if (!upstreamBase) {
            sendJson(res, 500, { error: "网关未配置 UPSTREAM_BASE" });
            return;
        }

        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const contentType = String(req.headers["content-type"] || "");
        let body = raw;
        const used = [];

        if (contentType.includes("application/json") && raw.length) {
            try {
                const parsed = JSON.parse(raw.toString("utf8"));
                injectGuides(parsed, used);
                body = Buffer.from(JSON.stringify(parsed), "utf8");
            } catch {
                // 非法 JSON 原样转发，交给上游报错
            }
        }

        const headers = { ...req.headers };
        delete headers.host;
        delete headers["content-length"];
        delete headers.origin;
        delete headers.referer;
        delete headers["accept-encoding"];
        delete headers["x-canvas-token"];
        delete headers[CODE_HEADER];
        if (upstreamKey) {
            headers.authorization = `Bearer ${upstreamKey}`;
            // Gemini 协议用 x-goog-api-key 鉴权。仅当原请求就是 Gemini 请求时才补，
            // 免得把多余的鉴权头塞给 OpenAI 兼容通道。
            const isGemini = headers["x-goog-api-key"] !== undefined || path.includes("/v1beta");
            if (isGemini) headers["x-goog-api-key"] = upstreamKey;
        }

        try {
            const upstream = await fetch(`${upstreamBase}${path}`, {
                method: req.method,
                headers,
                body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
            });
            const responseHeaders = {};
            upstream.headers.forEach((value, key) => {
                if (!SKIP_RESPONSE_HEADERS.has(key)) responseHeaders[key] = value;
            });
            applyCors(res);
            res.writeHead(upstream.status, responseHeaders);
            if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
            else res.end();
            touchUsage(caller || "(未设访问码)", used);
            console.log(`${req.method} ${path} -> ${upstream.status} caller=${caller || "-"} guides=${used.join(",") || "-"}`);
        } catch (error) {
            sendJson(res, 502, { error: `转发失败: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    return {
        handle,
        usage,
        info: {
            upstreamBase,
            keyMode: upstreamKey ? "服务端注入" : "透传前端 Authorization",
            codeRequired: requireCode,
            codes: [...accessCodes.values()],
            guides: Object.keys(commerceGuides),
        },
    };
}
