import { unzipSync } from "fflate";

import type { CommerceSkillPackage } from "./commerce-skills";

const decoder = new TextDecoder();

export async function readCommerceSkillPackage(file: File) {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const paths = Object.keys(archive).filter((path) => !path.endsWith("/") && !path.split("/").some((part) => part === "__MACOSX" || part.startsWith(".")));
    const entryFile = paths.find((path) => /(^|\/)SKILL\.md$/i.test(path));
    if (!entryFile) throw new Error("压缩包中没有找到 SKILL.md");
    const skillText = decoder.decode(archive[entryFile]);
    const references = paths.filter((path) => /(^|\/)references\/.*\.md$/i.test(path)).map((path) => ({ path, content: decoder.decode(archive[path]) }));
    const scripts = paths.filter((path) => /(^|\/)scripts?\/|\.(?:js|mjs|cjs|ts|tsx|py|swift|sh|ps1)$/i.test(path));
    const assets = paths.filter((path) => /(^|\/)(assets?|templates?)\//i.test(path));
    const metadata = parseFrontmatter(skillText);
    const title = skillText.match(/^#\s+(.+)$/m)?.[1]?.trim() || metadata.name || file.name.replace(/\.zip$/i, "");
    const packageInfo: CommerceSkillPackage = { format: "zip", fileName: file.name, entryFile, references, assets, scripts, fileCount: paths.length };
    return { title, description: metadata.description || "从 ZIP 技能包导入的自定义技能", planningGuide: skillText, packageInfo };
}

function parseFrontmatter(text: string) {
    const body = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1] || "";
    const value = (key: string) => body.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "";
    return { name: value("name"), description: value("description") };
}
