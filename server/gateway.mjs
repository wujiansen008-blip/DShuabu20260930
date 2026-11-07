#!/usr/bin/env node
// 本地启动器：读 server/.env.local，起一个本机网关。核心逻辑在 core.mjs，云端复用同一份。
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGateway } from "./core.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

function loadEnvFile(path) {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (!(key in process.env)) process.env[key] = value;
    }
}

loadEnvFile(here("./.env.local"));

const PORT = Number(process.env.GATEWAY_PORT || 8787);
const HOST = process.env.GATEWAY_HOST || "127.0.0.1";
const gateway = createGateway();

const server = createServer((req, res) => {
    void gateway.handle(req, res);
});

server.listen(PORT, HOST, () => {
    const info = gateway.info;
    console.log(`canvas gateway  http://${HOST}:${PORT}`);
    console.log(`upstream        ${info.upstreamBase || "(未配置，请求会直接报错)"}`);
    console.log(`key             ${info.keyMode}`);
    console.log(`访问码          ${info.codeRequired ? `已启用（${info.codes.join(", ")}）` : "未启用，任何人可调用"}`);
    console.log(`技能口令        ${info.guides.join(", ")}`);
});
