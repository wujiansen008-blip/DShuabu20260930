// Vercel 函数入口（catch-all）：/api/* 全部交给网关核心处理。
// 与本地 server/gateway.mjs 共用 server/core.mjs，行为一致，只是挂载前缀不同。
import { createGateway } from "../server/core.mjs";

const gateway = createGateway();

export const config = { maxDuration: 60 };

export default function handler(req, res) {
    return gateway.handle(req, res);
}
