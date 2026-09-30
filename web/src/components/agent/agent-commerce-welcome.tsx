import { useMemo, useState } from "react";
import { Input, Popover } from "antd";
import { BookOpen, Bot, Search, ShieldCheck } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";

type PresetSkill = {
    id: string;
    title: string;
    description: string;
    prompt: string;
    aliases: string[];
};

const PRESET_SKILLS: PresetSkill[] = [
    { id: "hero", title: "商品主图设计", description: "提炼卖点并规划适合电商平台的商品主图", aliases: ["商品主图", "主图", "hero"], prompt: "请分析我上传的商品素材，为这个商品设计一套电商主图方案。先提炼核心卖点和目标人群，再给出画面结构、文案与生成建议；素材信息不足时先向我提问。" },
    { id: "detail", title: "商品详情页设计", description: "规划详情页结构、文案与视觉表达", aliases: ["详情页", "商品详情", "detail"], prompt: "请根据我上传的商品素材，策划一套完整的电商详情页。输出页面结构、每屏目标、标题文案、卖点证据和视觉建议；素材信息不足时先向我提问。" },
    { id: "buyer", title: "买家秀设计", description: "生成自然、可信、有生活感的买家秀方案", aliases: ["买家秀", "buyer"], prompt: "请根据我上传的商品图片，设计真实自然的买家秀内容。先确定使用场景和人物特征，再给出构图、光线、动作、环境及可直接用于生成的提示词。" },
    { id: "competitor", title: "竞品复刻", description: "拆解参考素材并生成可执行的同类方案", aliases: ["竞品", "复刻", "competitor"], prompt: "请拆解我提供的竞品或参考素材，分析其构图、卖点、文案、色彩和转化逻辑，并为我的商品输出一套可执行的同类方案。避免直接复制品牌元素。" },
    { id: "poster", title: "电商营销海报", description: "策划活动海报、品牌视觉与促销表达", aliases: ["海报", "营销", "poster"], prompt: "请根据商品素材与活动信息，设计一张电商营销海报。输出传播目标、视觉层级、主副文案、构图、配色及生成提示词；缺少活动信息时先向我提问。" },
    { id: "diagnose", title: "详情页诊断", description: "诊断卖点结构、信息层级与视觉一致性", aliases: ["诊断", "detail"], prompt: "请诊断我提供的商品详情页或页面截图，从用户决策路径、卖点证据、信息层级、视觉一致性和转化阻力五个方面给出问题清单与修改优先级。" },
    { id: "ugc", title: "UGC 带货视频", description: "输出短视频脚本、镜头和口播方案", aliases: ["UGC", "带货视频", "视频"], prompt: "请为这个商品策划一条 UGC 带货短视频。输出目标人群、前三秒钩子、分镜、口播、画面动作、字幕和结尾行动引导；素材不足时先向我提问。" },
    { id: "cover", title: "小红书大字封面", description: "生成高点击封面结构与标题文案", aliases: ["小红书", "封面", "cover"], prompt: "请根据商品与内容主题设计小红书大字封面，给出 5 组标题、推荐构图、人物或产品摆位、字体层级、配色与生成提示词。" },
];

export function AgentCommerceWelcome({ theme, connected, onOpenSetup }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; connected: boolean; onOpenSetup: () => void }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const installedSkills = useAgentSkillStore((state) => state.skills);
    const selectSkill = useAgentSkillStore((state) => state.selectSkill);
    const filtered = useMemo(() => PRESET_SKILLS.filter((skill) => `${skill.title}${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())), [query]);
    const choose = (preset: PresetSkill) => {
        const installed = installedSkills.find((skill) => skill.enabled && preset.aliases.some((alias) => `${skill.name} ${skill.interface?.displayName || ""}`.toLowerCase().includes(alias.toLowerCase())));
        selectSkill(installed || null, preset.prompt);
        setOpen(false);
    };
    const library = (
        <div className="w-[min(360px,calc(100vw-48px))]">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} prefix={<Search className="size-4 opacity-50" />} placeholder="搜索技能" allowClear />
            <div className="thin-scrollbar mt-2 max-h-80 space-y-1 overflow-y-auto pr-1">
                {filtered.map((skill) => (
                    <button key={skill.id} type="button" className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-black/5 dark:hover:bg-white/10" onClick={() => choose(skill)}>
                        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                        <span className="min-w-0"><span className="block text-sm font-medium">{skill.title}</span><span className="mt-0.5 block text-xs leading-5 opacity-60">{skill.description}</span></span>
                    </button>
                ))}
            </div>
        </div>
    );
    return (
        <div className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6" style={{ color: theme.node.text }}>
            <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
                <div className="mx-auto grid size-16 place-items-center rounded-2xl border" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}><Bot className="size-8 text-fuchsia-500" /></div>
                <h2 className="mt-4 text-center text-xl font-semibold">电商 AI 助手</h2>
                <p className="mt-2 text-center text-sm leading-6" style={{ color: theme.node.muted }}>选择一个技能快速开始，也可以直接上传商品图片并描述你的需求</p>
                {!connected ? <button type="button" className="mx-auto mt-3 rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }} onClick={onOpenSetup}>当前使用本地 Agent，连接后即可执行</button> : null}
                <div className="mt-6 grid gap-2">
                    {PRESET_SKILLS.slice(0, 4).map((skill) => (
                        <button key={skill.id} type="button" className="flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-md" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }} onClick={() => choose(skill)}>
                            <BookOpen className="mt-0.5 size-4 shrink-0" /><span><span className="block text-sm font-medium">{skill.title}</span><span className="mt-0.5 block text-xs leading-5" style={{ color: theme.node.muted }}>{skill.description}</span></span>
                        </button>
                    ))}
                </div>
                <Popover content={library} trigger="click" open={open} onOpenChange={setOpen} placement="bottom">
                    <button type="button" className="mx-auto mt-4 flex items-center gap-2 rounded-full px-4 py-2 text-sm transition hover:bg-black/5 dark:hover:bg-white/10"><BookOpen className="size-4" />查看全部技能</button>
                </Popover>
            </div>
        </div>
    );
}
