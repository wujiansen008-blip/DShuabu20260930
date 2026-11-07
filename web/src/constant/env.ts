export const APP_VERSION = __APP_VERSION__ || "dev";

// 分发构建（vite build --mode dist）时隐藏所有指向外部来源的入口：
// 顶栏 GitHub 仓库图标、版本号、文档图标、画布菜单里的文档项。
// 本地开发不设置该变量，界面与原来完全一致。
export const HIDE_SOURCE_LINKS = import.meta.env.VITE_HIDE_SOURCE_LINKS === "1";

// 网关地址：本地开发直连本机网关，线上部署走同域 /api（Vercel 函数）。
// 想临时绕过网关做本地调试时，设 VITE_GATEWAY_OFF=1 即可让请求直连你在界面里配置的通道。
export const GATEWAY_ENABLED = import.meta.env.VITE_GATEWAY_OFF !== "1";
export const GATEWAY_BASE_URL = import.meta.env.VITE_GATEWAY_URL?.trim() || (import.meta.env.DEV ? "http://127.0.0.1:8787" : `${window.location.origin}/api`);

// 统一出口：分发构建下浏览器不持有上游 key，图片/视频/音频/文本请求全部经网关转发，
// 由网关注入真实密钥。本地开发默认关闭，仍可直连自己配置的通道调试。
export const GATEWAY_AI_ENABLED = import.meta.env.VITE_AI_VIA_GATEWAY === "1" && GATEWAY_ENABLED;

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

// Official plugin registry URL: 线上走同域网关（避免产物暴露上游仓库地址），本地开发仍用官方 CDN。
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || (import.meta.env.DEV ? "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json" : `${GATEWAY_BASE_URL}/__official-plugins.json`);
