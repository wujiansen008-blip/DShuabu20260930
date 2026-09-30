import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { App, Button, Checkbox, Drawer, Input, Modal, Popover, Select as AntSelect, Slider, Switch, Tooltip } from "antd";
import { ArrowLeft, ArrowUp, BookOpen, Bot, Box, Check, ChevronDown, ChevronUp, Copy, Download, Eye, History, ImagePlus, Link2, ListTodo, LoaderCircle, LocateFixed, Paperclip, Pencil, Plus, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, Square, Trash2, Video, X, Zap } from "lucide-react";
import { nanoid } from "nanoid";

import { canvasThemes } from "@/lib/canvas-theme";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { imageAspectOptions } from "@/components/image-settings-panel";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { resolveCanvasReferenceImages, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { readCommerceSkillPackage } from "@/lib/commerce/commerce-skill-package";
import { commerceSkills, type CommerceSkill, type CommerceSkillId } from "@/lib/commerce/commerce-skills";
import { getDataUrlByteSize, prepareImageForAnalysis, readImageMeta } from "@/lib/image-utils";
import { computeVideoSize, inferVideoRatio, parseVideoResolution, videoRatioOptions } from "@/lib/media-size";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { loadCommerceAssistant, loadCommerceCustomSkills, saveCommerceAssistant, saveCommerceCustomSkills, type CommerceAssistantTask } from "@/services/commerce-assistant-storage";
import { useAgentStore, type AgentAttachment } from "@/stores/use-agent-store";
import { useConfigStore, useEffectiveConfig, videoModelCapabilities, type AiConfig, type VideoModelCapabilities } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "@/types/canvas";

type ProductAnalysis = { category: string; visibleFacts: string[]; verifiedFacts: string[]; unknownFacts: string[]; identityLock: string[] };
type StrategySection = { id: string; label: string; content: string };
type PlanItem = { id: string; title: string; role: string; goal: string; copy: string; materials?: string; template?: string; composition?: string; components?: string; prompt: string; ratio: string; checks: string[]; selected: boolean; outputNodeId?: string; status?: "idle" | "pending" | "loading" | "success" | "error"; errorDetails?: string };
type CommercePlan = { title: string; summary: string; strategy: string; productAnalysis: ProductAnalysis; strategySections?: StrategySection[]; items: PlanItem[]; resultGroupId?: string };
type RequestPhase = "analysis" | "generation";
type ChatItem = { id: string; role: "user" | "assistant" | "error"; text: string; attachments?: string[]; phase?: RequestPhase; model?: string; endpoint?: string; retry?: RequestPhase };
type RunState = { current: number; total: number; failed: number } | null;
type PlanResponse = CommercePlan | { questions: string[] };
type ExecutionMode = "automatic" | "confirm" | "plan";
type MediaRole = "product" | "reference";
type BuyerMode = "multi-scene" | "same-scene" | "angle-variation";
type CompetitorMode = "composition" | "scene" | "visual-language";
type HeroStage = "prepare" | "analysis" | "plan" | "results";
type DetailStage = "prepare" | "analysis" | "structure" | "content" | "results";
type BuyerStage = "prepare" | "analysis" | "scenes" | "content" | "results";
type CompetitorStage = "prepare" | "analysis" | "migration" | "content" | "results";
type WorkflowStage = HeroStage | DetailStage | BuyerStage | CompetitorStage;
type CreationType = "agent" | "image" | "video";
type DirectMedia = { id: string; name: string; kind: "video" | "audio"; dataUrl: string; type: string; size: number };
type AssetPickerTarget = MediaRole | "video";
type SkillFieldDraft = { id: string; label: string; type: "text" | "select"; options: string };
type SkillDraft = { title: string; description: string; defaultRequest: string; planningGuide: string; materialMode: "product" | "product-reference"; fields: SkillFieldDraft[]; packageInfo?: CommerceSkill["packageInfo"] };
const MAX_COMPOSER_IMAGES = 20;
const createEmptySkillDraft = (): SkillDraft => ({ title: "", description: "", defaultRequest: "请根据当前素材和要求执行这个技能。", planningGuide: "", materialMode: "product", fields: [] });

const planSystemPrompt = `你是内置在电商画布中的视觉策划智能体。你需要根据用户的商品图片、参考图片和需求，输出可直接执行的图片生成方案。
先从用户当前消息、前文和图片中提取已经提供的信息，不要重复询问。能够通过图片判断或采用安全创意默认值时直接完成方案。只有缺失信息会阻止生成或可能造成事实错误时，才返回：
{"status":"needs_input","questions":["最多两个简短、必要的问题"]}
其余情况只返回一个 JSON 对象，不要使用 Markdown 代码块。结构必须是：
{"status":"ready","title":"方案标题","summary":"对商品与目标的简要判断","strategy":"整体视觉策略","productAnalysis":{"category":"商品品类","visibleFacts":["从图片可确认的事实"],"verifiedFacts":["用户明确提供的事实"],"unknownFacts":["仍不能确认且不得写入图片的事实"],"identityLock":["所有生成图必须保持不变的外形、颜色、材质、标签位置、结构、接口和配件数量"]},"strategySections":[{"label":"专业分析环节名称","content":"具体结论、依据、假设和风险"}],"items":[{"title":"画面或模块名称","role":"转化目标或该图在购买决策中的职责","goal":"具体画面内容与表达目标","copy":"最终上图文案或文案方向","materials":"计划使用的素材","template":"页面模板","composition":"构图与机位","components":"组件与主体/文字布局","prompt":"完整、具体、可直接用于图片生成模型的中文提示词","ratio":"1:1","checks":["该画面生成后需要检查的项目"]}]}
ratio 使用 1:1、3:4、4:3、16:9、9:16 或 auto。必须把图片观察、用户声明和未知信息分开，不得把推测写成商品事实。identityLock 要具体描述真实商品，不能只写“保持一致”。每个画面只承担一个主要销售任务；提示词应区分允许改变的场景与必须保持的商品。
每个 item.prompt 必须是一段连续、可直接提交给生图模型的中文提示词，并按以下逻辑写全：先声明商品身份与本图唯一任务；再把核心卖点翻译为具体可见的场景、状态、动作结果或物体关系，不能只靠标题文字表达；随后明确主体位置、画面占比、视角、景别、留白和主次秩序；描述与参考商品一致的结构、边缘、纹理、厚薄、透明度、反光和触感等材质细节；统一背景、产品主辅色、光线和符合当前技能的成像风格；最后写文字政策、质量要求与负面约束。商品主图与详情页允许文字时，文字只承担补充说明，颜色应取自产品主色、辅色或相近色；买家秀必须使用手机原图感且画面中禁止文字和海报排版。负面约束至少排除商品身份变化、无关元素、主体过小、卖点偏移、透视错误、材质失真、配色冲突、低清晰度以及未确认的参数、功能、认证和效果；背景整洁度、构图完整度和商业设计感必须服从当前技能规则。`;

export function CommerceAssistantPanel({ onOpenLocalAgent }: { onOpenLocalAgent: () => void }) {
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [skillId, setSkillId] = useState<CommerceSkillId | null>(null);
    const [creationType, setCreationType] = useState<CreationType>("agent");
    const [skillsOpen, setSkillsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [customSkills, setCustomSkills] = useState<CommerceSkill[]>([]);
    const [skillTab, setSkillTab] = useState<"all" | "system" | "mine">("all");
    const [prompt, setPrompt] = useState("");
    const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
    const [directMedia, setDirectMedia] = useState<DirectMedia[]>([]);
    const [references, setReferences] = useState<CanvasResourceReference[]>([]);
    const [messages, setMessages] = useState<ChatItem[]>([]);
    const [plan, setPlan] = useState<CommercePlan | null>(null);
    const [busy, setBusy] = useState(false);
    const [activePhase, setActivePhase] = useState<RequestPhase | null>(null);
    const [runState, setRunState] = useState<RunState>(null);
    const [ratio, setRatio] = useState(config.size || "auto");
    const [count, setCount] = useState(() => Math.max(1, Math.min(15, Math.floor(Number(config.canvasImageCount || config.count)) || 1)));
    const [executionMode, setExecutionMode] = useState<ExecutionMode>(() => (localStorage.getItem("commerce-assistant-execution-mode") as ExecutionMode) || "confirm");
    const [brief, setBrief] = useState<Record<string, string>>({});
    const [mediaRoles, setMediaRoles] = useState<Record<string, MediaRole>>({});
    const [heroStage, setHeroStage] = useState<HeroStage>("prepare");
    const [detailStage, setDetailStage] = useState<DetailStage>("prepare");
    const [buyerStage, setBuyerStage] = useState<BuyerStage>("prepare");
    const [competitorStage, setCompetitorStage] = useState<CompetitorStage>("prepare");
    const [activeTaskId, setActiveTaskId] = useState(() => nanoid());
    const [taskName, setTaskName] = useState("未命名任务");
    const [taskRecords, setTaskRecords] = useState<CommerceAssistantTask[]>([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyQuery, setHistoryQuery] = useState("");
    const [mentionOpen, setMentionOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [assetPickerTarget, setAssetPickerTarget] = useState<AssetPickerTarget>("product");
    const [skillEditorOpen, setSkillEditorOpen] = useState(false);
    const [packageSkillId, setPackageSkillId] = useState<CommerceSkillId | null>(null);
    const [editingSkillId, setEditingSkillId] = useState<CommerceSkillId | null>(null);
    const [skillDraft, setSkillDraft] = useState<SkillDraft>(createEmptySkillDraft);
    const [restored, setRestored] = useState(false);
    const stopRef = useRef<AbortController | null>(null);
    const conversationScrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const skillFileInputRef = useRef<HTMLInputElement>(null);
    const uploadRoleRef = useRef<MediaRole>("product");
    const allSkills = useMemo(() => [...commerceSkills, ...customSkills], [customSkills]);
    const skill = skillId ? allSkills.find((item) => item.id === skillId) || null : null;
    const packageSkill = packageSkillId ? allSkills.find((item) => item.id === packageSkillId) || null : null;
    const projectId = useAgentStore((state) => state.canvasContext?.snapshot.projectId || "");
    const filteredSkills = useMemo(() => allSkills.filter((item) => (skillTab === "system" ? !item.id.startsWith("custom:") : skillTab === "mine" ? item.id.startsWith("custom:") : true) && `${item.title}${item.description}`.toLowerCase().includes(query.trim().toLowerCase())), [allSkills, query, skillTab]);
    const textConfig = buildGenerationConfig(config, undefined, "text");
    const imageConfig = buildGenerationConfig(config, undefined, "image");
    const videoConfig = buildGenerationConfig(config, undefined, "video");
    const videoCapabilities = videoModelCapabilities(config, config.videoModel);
    const textReady = isAiConfigReady(textConfig, textConfig.model);
    const imageReady = isAiConfigReady(imageConfig, imageConfig.model);
    const videoReady = isAiConfigReady(videoConfig, videoConfig.model);
    const changeGenerationCount = (nextCount: number) => {
        setCount(nextCount);
        setPlan((current) => current ? { ...current, items: current.items.map((item, index) => ({ ...item, selected: index < nextCount })) } : current);
    };

    useEffect(() => { void loadCommerceCustomSkills().then((items) => setCustomSkills(items || [])); }, []);

    const applyTask = (saved: CommerceAssistantTask, focusWorkspace = false) => {
        const canvasContext = useAgentStore.getState().canvasContext;
        const nodeIds = new Set((canvasContext?.snapshot.nodes || []).map((node) => node.id));
        const savedPlan = (saved.plan as CommercePlan | null) || null;
        const restoredPlan = savedPlan ? { ...savedPlan, resultGroupId: savedPlan.resultGroupId && nodeIds.has(savedPlan.resultGroupId) ? savedPlan.resultGroupId : undefined, items: savedPlan.items.map((item) => ({ ...item, outputNodeId: item.outputNodeId && nodeIds.has(item.outputNodeId) ? item.outputNodeId : undefined })) } : null;
        const hasResults = Boolean(restoredPlan?.items.some((item) => item.outputNodeId));
        const hero = !restoredPlan ? "prepare" : hasResults ? "results" : saved.heroStage === "analysis" ? "analysis" : "plan";
        const detail = !restoredPlan ? "prepare" : hasResults ? "results" : saved.detailStage === "analysis" || saved.detailStage === "structure" || saved.detailStage === "content" ? saved.detailStage : "content";
        const buyer = !restoredPlan ? "prepare" : hasResults ? "results" : saved.buyerStage === "analysis" || saved.buyerStage === "scenes" || saved.buyerStage === "content" ? saved.buyerStage : "content";
        const competitor = !restoredPlan ? "prepare" : hasResults ? "results" : saved.competitorStage === "analysis" || saved.competitorStage === "migration" || saved.competitorStage === "content" ? saved.competitorStage : "content";
        setActiveTaskId(saved.id);
        setTaskName(saved.title || "未命名任务");
        setSkillId((saved.skillId as CommerceSkillId | null) || null);
        setPrompt(saved.prompt || "");
        setMessages(saved.messages || []);
        setPlan(restoredPlan);
        setRatio(saved.ratio || "auto");
        setCount(saved.count || 1);
        setExecutionMode(saved.executionMode || "confirm");
        setBrief(saved.brief || {});
        setAttachments((saved.attachments as AgentAttachment[]) || []);
        setReferences((saved.references as CanvasResourceReference[]) || []);
        setMediaRoles(saved.mediaRoles || {});
        setHeroStage(hero);
        setDetailStage(detail);
        setBuyerStage(buyer);
        setCompetitorStage(competitor);
        setRunState(null);
        if (focusWorkspace) window.requestAnimationFrame(() => {
            conversationScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            if (restoredPlan?.resultGroupId) canvasContext?.focusNode(restoredPlan.resultGroupId);
        });
    };

    useEffect(() => {
        let active = true;
        setRestored(false);
        if (!projectId) return;
        setSkillId(null);
        setPrompt("");
        setMessages([]);
        setPlan(null);
        setRunState(null);
        setRatio(config.size || "auto");
        setCount(Math.max(1, Math.min(15, Math.floor(Number(config.canvasImageCount || config.count)) || 1)));
        setExecutionMode((localStorage.getItem("commerce-assistant-execution-mode") as ExecutionMode) || "confirm");
        setBrief({});
        setAttachments([]);
        setReferences([]);
        setMediaRoles({});
        setHeroStage("prepare");
        setDetailStage("prepare");
        setBuyerStage("prepare");
        setCompetitorStage("prepare");
        setTaskRecords([]);
        void loadCommerceAssistant(projectId).then((saved) => {
            if (!active) return;
            if (saved?.version === 4 && saved.tasks.length) {
                setTaskRecords(saved.tasks);
                applyTask(saved.tasks.find((task) => task.id === saved.activeTaskId) || saved.tasks[0]);
            } else {
                setActiveTaskId(nanoid());
                setTaskName("未命名任务");
            }
            setRestored(true);
        });
        return () => { active = false; };
    }, [projectId]);

    useEffect(() => {
        if (!projectId || !restored) return;
        const timer = window.setTimeout(() => {
            const task: CommerceAssistantTask = { id: activeTaskId, title: taskName || "未命名任务", updatedAt: Date.now(), skillId, prompt, messages, plan, ratio, count, executionMode, brief, attachments, references, mediaRoles, heroStage, detailStage, buyerStage, competitorStage };
            setTaskRecords((current) => {
                const next = [task, ...current.filter((item) => item.id !== activeTaskId)].sort((a, b) => b.updatedAt - a.updatedAt);
                void saveCommerceAssistant(projectId, { version: 4, activeTaskId, tasks: next });
                return next;
            });
        }, 250);
        return () => window.clearTimeout(timer);
    }, [activeTaskId, attachments, brief, buyerStage, competitorStage, count, detailStage, executionMode, heroStage, mediaRoles, messages, plan, projectId, prompt, ratio, references, restored, skillId, taskName]);

    const chooseSkill = (next: CommerceSkill, preservePrompt = false) => {
        setCreationType("agent");
        if (skillId === next.id) {
            setSkillsOpen(false);
            setMentionOpen(false);
            return;
        }
        const switching = Boolean(skillId && skillId !== next.id);
        setSkillId(next.id);
        if (switching || taskName === "未命名任务") setTaskName(next.title);
        if (!preservePrompt) setPrompt("");
        setPlan(null);
        setRunState(null);
        setBrief(next.id === "buyer" ? { buyerMode: "multi-scene" } : next.id === "competitor" ? { competitorMode: "composition" } : {});
        setHeroStage("prepare");
        setDetailStage("prepare");
        setBuyerStage("prepare");
        setCompetitorStage("prepare");
        if (next.defaultRatio) setRatio(next.defaultRatio);
        if (next.defaultCount) setCount(next.defaultCount);
        setMediaRoles({});
        setMessages((current) => switching ? [...current, { id: nanoid(), role: "assistant", text: `已切换到“${next.title}”，接下来会按这个技能处理你的素材和要求。` }] : current);
        setSkillsOpen(false);
        setMentionOpen(false);
    };

    const addFiles = async (files: FileList | File[] | null, role = uploadRoleRef.current) => {
        const available = Math.max(0, MAX_COMPOSER_IMAGES - attachments.length - references.length);
        const selected = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const images = selected.slice(0, available);
        if (!available) return void message.warning(`最多上传 ${MAX_COMPOSER_IMAGES} 张图片，请先移除部分素材`);
        if (selected.length > available) message.warning(`最多保留 ${MAX_COMPOSER_IMAGES} 张图片，本次已添加前 ${available} 张`);
        const next = await Promise.all(images.map(async (file) => {
            const dataUrl = await fileToDataUrl(file);
            const meta = await readImageMeta(dataUrl);
            return { id: nanoid(), name: file.name, type: file.type || meta.mimeType, size: file.size, width: meta.width, height: meta.height, url: dataUrl, dataUrl } satisfies AgentAttachment;
        }));
        setMediaRoles((current) => ({ ...current, ...Object.fromEntries(next.map((item) => [item.id, role])) }));
        setAttachments((current) => [...current, ...next]);
        uploadRoleRef.current = "product";
    };
    const referenceResultImage = (item: PlanItem, node: CanvasNodeData) => {
        const src = node.metadata?.content || "";
        if (!src) return;
        const referenceId = `commerce-result:${node.id}:${node.metadata?.primaryImageId || node.metadata?.storageKey || "current"}`;
        if (attachments.some((attachment) => attachment.id === referenceId)) {
            message.info("这张图片已经在输入素材中");
            return;
        }
        if (attachments.length + references.length >= MAX_COMPOSER_IMAGES) return void message.warning(`最多使用 ${MAX_COMPOSER_IMAGES} 张图片，请先移除部分素材`);
        const attachment: AgentAttachment = {
            id: referenceId,
            name: `${item.title || "生成结果"}.png`,
            type: node.metadata?.mimeType || "image/png",
            size: node.metadata?.bytes || getDataUrlByteSize(src),
            width: node.metadata?.naturalWidth || node.width,
            height: node.metadata?.naturalHeight || node.height,
            url: src,
            dataUrl: src,
        };
        setAttachments((current) => [...current, attachment]);
        setMediaRoles((current) => ({ ...current, [referenceId]: "reference" }));
        message.success("已引用到下方输入框，可继续描述修改要求");
    };
    const addDirectMedia = async (files: FileList | null, kind: DirectMedia["kind"]) => {
        const next = await Promise.all(Array.from(files || []).map(async (file) => ({ id: nanoid(), name: file.name, kind, dataUrl: await fileToDataUrl(file), type: file.type, size: file.size })));
        setDirectMedia((current) => [...current, ...next]);
    };
    const addAsset = async (payload: InsertAssetPayload) => {
        if (assetPickerTarget === "video") {
            if (payload.kind !== "video") return;
            setDirectMedia((current) => [...current, { id: nanoid(), name: payload.title, kind: "video", dataUrl: payload.url, type: "video/mp4", size: 0 }]);
            setAssetPickerOpen(false);
            return;
        }
        if (payload.kind !== "image") return;
        if (attachments.length + references.length >= MAX_COMPOSER_IMAGES) return void message.warning(`最多使用 ${MAX_COMPOSER_IMAGES} 张图片，请先移除部分素材`);
        try {
            const meta = await readImageMeta(payload.dataUrl);
            const item = { id: nanoid(), name: payload.title, type: meta.mimeType, size: 0, width: meta.width, height: meta.height, url: payload.dataUrl, dataUrl: payload.dataUrl } satisfies AgentAttachment;
            setMediaRoles((current) => ({ ...current, [item.id]: assetPickerTarget }));
            setAttachments((current) => [...current, item]);
            setAssetPickerOpen(false);
        } catch { message.error("资产图片读取失败，请检查该素材是否仍然可用"); }
    };
    const openAssetPicker = (target: AssetPickerTarget = "product") => {
        setAssetPickerTarget(target);
        setAssetPickerOpen(true);
    };
    const updateCanvasReferences = (next: CanvasResourceReference[], role: MediaRole) => {
        const available = Math.max(0, MAX_COMPOSER_IMAGES - attachments.length);
        const limited = next.slice(0, available);
        if (next.length > available) message.warning(`最多使用 ${MAX_COMPOSER_IMAGES} 张图片，请先移除部分素材`);
        const added = limited.filter((item) => !references.some((current) => current.nodeId === item.nodeId));
        if (added.length) setMediaRoles((current) => ({ ...current, ...Object.fromEntries(added.map((item) => [item.nodeId, role])) }));
        setReferences(limited);
    };
    const importSkillFile = async (file?: File) => {
        if (!file) return;
        try {
            let source: Partial<CommerceSkill> = {};
            if (/\.zip$/i.test(file.name)) {
                source = { ...(await readCommerceSkillPackage(file)), defaultRequest: "请根据当前素材和要求执行这个技能。", fields: [] };
            } else {
                const text = await file.text();
                try { source = JSON.parse(text) as Partial<CommerceSkill>; } catch {
                    const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
                    source = { title: heading || file.name.replace(/\.[^.]+$/, ""), description: "从本地文件导入的自定义技能", defaultRequest: "请根据当前素材和要求执行这个技能。", planningGuide: text, fields: [] };
                }
            }
            const title = String(source.title || file.name.replace(/\.[^.]+$/, "")).trim();
            const planningGuide = String(source.planningGuide || "").trim();
            if (!title || !planningGuide) throw new Error("技能文件需要包含名称和完整技能说明");
            const imported: CommerceSkill = { id: `custom:${nanoid()}`, title, description: String(source.description || "自定义导入技能"), defaultRequest: String(source.defaultRequest || "请根据当前素材和要求执行这个技能。"), planningGuide, materialMode: source.materialMode === "product-reference" ? "product-reference" : "product", fields: Array.isArray(source.fields) ? source.fields.filter((field) => field && typeof field.key === "string" && typeof field.label === "string").map((field) => ({ key: String(field.key), label: String(field.label), placeholder: String(field.placeholder || "请输入信息"), options: Array.isArray(field.options) ? field.options.map(String) : undefined })) : [], packageInfo: source.packageInfo };
            const next = [...customSkills, imported];
            setCustomSkills(next);
            await saveCommerceCustomSkills(next);
            setSkillTab("mine");
            message.success(`已导入技能“${title}”`);
        } catch (error) { message.error(error instanceof Error ? error.message : "技能导入失败"); }
    };
    const removeCustomSkill = (skillToRemove: CommerceSkill) => modal.confirm({ title: `删除技能“${skillToRemove.title}”？`, content: "只会删除本机导入的技能，不会删除已经生成到画布中的内容。", okText: "删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: async () => {
        const next = customSkills.filter((item) => item.id !== skillToRemove.id);
        setCustomSkills(next);
        await saveCommerceCustomSkills(next);
        if (skillId === skillToRemove.id) { setSkillId(null); setPlan(null); setMessages([]); setPrompt(""); setAttachments([]); setReferences([]); setBrief({}); setMediaRoles({}); }
    } });
    const openSkillEditor = (source?: CommerceSkill, copy = false) => {
        setEditingSkillId(source && !copy && source.id.startsWith("custom:") ? source.id : null);
        setSkillDraft(source ? { title: copy ? `${source.title} 副本` : source.title, description: source.description, defaultRequest: source.defaultRequest, planningGuide: source.planningGuide, materialMode: source.materialMode || "product", fields: source.fields.map((field) => ({ id: nanoid(), label: field.label, type: field.options?.length ? "select" : "text", options: field.options?.join("\n") || "" })), packageInfo: source.packageInfo } : createEmptySkillDraft());
        setSkillEditorOpen(true);
    };
    const saveSkillDraft = async () => {
        const title = skillDraft.title.trim();
        const planningGuide = skillDraft.planningGuide.trim();
        if (!title || !planningGuide) return message.warning("请填写技能名称和完整工作流程");
        const fields = skillDraft.fields.filter((field) => field.label.trim()).map((field, index) => ({ key: `customField${index + 1}`, label: field.label.trim(), placeholder: field.type === "select" ? "请选择" : `请填写${field.label.trim()}`, options: field.type === "select" ? field.options.split(/\r?\n|[,，]/).map((option) => option.trim()).filter(Boolean) : undefined }));
        const saved: CommerceSkill = { id: editingSkillId || `custom:${nanoid()}`, title, description: skillDraft.description.trim() || "自定义电商技能", defaultRequest: skillDraft.defaultRequest.trim() || "请根据当前素材和要求执行这个技能。", planningGuide, materialMode: skillDraft.materialMode, fields, packageInfo: skillDraft.packageInfo };
        const next = editingSkillId ? customSkills.map((item) => item.id === editingSkillId ? saved : item) : [...customSkills, saved];
        setCustomSkills(next);
        await saveCommerceCustomSkills(next);
        setSkillEditorOpen(false);
        setEditingSkillId(null);
        setSkillTab("mine");
        message.success(editingSkillId ? "技能已更新" : "技能已创建");
    };
    const exportSkill = (source: CommerceSkill) => {
        const blob = new Blob([JSON.stringify({ title: source.title, description: source.description, defaultRequest: source.defaultRequest, planningGuide: source.planningGuide, materialMode: source.materialMode || "product", fields: source.fields, packageInfo: source.packageInfo }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${source.title.replace(/[\\/:*?"<>|]/g, "-") || "自定义技能"}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        message.success("技能文件已导出");
    };
    const chooseMentionSkill = (next: CommerceSkill) => {
        setPrompt((current) => removeMentionQuery(current));
        chooseSkill(next, true);
    };
    const chooseCreationType = (next: CreationType) => {
        setCreationType(next);
        if (next !== "agent") { setSkillId(null); setMentionOpen(false); }
    };
    const runDirectGeneration = () => {
        if (creationType === "agent") return message.warning("请先输入 @ 选择一个技能");
        const mode = creationType;
        if (!prompt.trim()) return message.warning(`请先描述要生成的${creationType === "image" ? "图片" : "视频"}`);
        const ready = creationType === "image" ? imageReady : videoReady;
        if (!ready) { openConfigDialog(true, "channels"); return message.warning(`请先完成${creationType === "image" ? "图片" : "视频"}模型配置`); }
        if (creationType === "video") {
            const issue = videoCapabilityIssue(videoCapabilities, videoConfig, attachments.length + references.length, directMedia);
            if (issue) return message.warning(issue);
        }
        const canvasContext = useAgentStore.getState().canvasContext;
        if (!canvasContext) return message.warning("当前画布尚未准备好");
        const snapshot = canvasContext.snapshot;
        const right = snapshot.nodes.length ? Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + 100 : 0;
        const top = snapshot.nodes.length ? Math.min(...snapshot.nodes.map((node) => node.position.y)) : 0;
        const promptId = `direct-prompt-${nanoid()}`;
        const configId = `direct-${mode}-${nanoid()}`;
        const attachmentOps = attachments.map((item, index) => { const size = fitNodeSize(item.width || 1, item.height || 1, 220, 220); return { type: "add_node" as const, id: `direct-source-${nanoid()}`, nodeType: CanvasNodeType.Image, title: item.name, position: { x: right, y: top + 280 + index * 240 }, width: size.width, height: size.height, metadata: { content: item.dataUrl, status: "success" as const, naturalWidth: item.width, naturalHeight: item.height, bytes: item.size, mimeType: item.type } }; });
        const mediaOps = directMedia.map((item, index) => ({ type: "add_node" as const, id: `direct-${item.kind}-${nanoid()}`, nodeType: item.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Audio, title: item.name, position: { x: right, y: top + 280 + (attachmentOps.length + index) * 180 }, width: 260, height: item.kind === "video" ? 180 : 100, metadata: { content: item.dataUrl, status: "success" as const, bytes: item.size, mimeType: item.type } }));
        const sourceIds = [...references.map((item) => item.nodeId), ...attachmentOps.map((item) => item.id), ...mediaOps.map((item) => item.id)];
        const tokens = [`@[node:${promptId}]`, ...sourceIds.map((id) => `@[node:${id}]`)].join("\n");
        const activeConfig = mode === "image" ? imageConfig : videoConfig;
        canvasContext.applyOps([
            ...attachmentOps,
            ...mediaOps,
            { type: "add_node", id: promptId, nodeType: CanvasNodeType.Text, title: `${mode === "image" ? "图片" : "视频"}生成提示词`, position: { x: right + 280, y: top }, width: 320, height: 220, metadata: { content: prompt.trim(), status: "success" as const, fontSize: 14 } },
            { type: "add_node", id: configId, nodeType: CanvasNodeType.Config, title: mode === "image" ? "图片生成" : "视频生成", position: { x: right + 660, y: top }, width: 360, height: 300, metadata: { generationMode: mode, composerContent: tokens, prompt: tokens, status: "idle" as const, model: activeConfig.model, size: mode === "image" ? ratio : activeConfig.size, quality: activeConfig.quality, count: mode === "image" ? count : 1, seconds: activeConfig.videoSeconds, vquality: activeConfig.vquality, generateAudio: activeConfig.videoGenerateAudio, watermark: activeConfig.videoWatermark, videoMode: activeConfig.videoMode } },
            { type: "connect_nodes", fromNodeId: promptId, toNodeId: configId },
            ...sourceIds.map((fromNodeId) => ({ type: "connect_nodes" as const, fromNodeId, toNodeId: configId })),
            { type: "select_nodes", ids: [configId] },
            { type: "run_generation", nodeId: configId, mode, prompt: tokens },
        ]);
        setPrompt("");
        message.success(`${creationType === "image" ? "图片" : "视频"}生成任务已添加到当前画布`);
    };

    const analyze = async (recordUserMessage = true) => {
        if (!skill) return;
        const userText = prompt.trim() || skill.defaultRequest;
        const revisionTargets = plan ? inferRevisionTargets(userText, plan.items.length) : [];
        const requestedCount = plan && revisionTargets.length ? plan.items.length : inferRequestedCount(userText, count);
        if (requestedCount !== count) setCount(requestedCount);
        const canvasContext = useAgentStore.getState().canvasContext;
        const validReferences = references.filter((item) => canvasContext?.snapshot.nodes.some((node) => node.id === item.nodeId));
        const media = [...attachments.map((item) => ({ id: item.id, label: item.name })), ...validReferences.map((item) => ({ id: item.nodeId, label: item.title }))];
        if (!media.length) return message.warning("请先上传商品图片，或从画布选择图片");
        if (skill.materialMode === "product-reference") {
            const roles = new Set(media.map((item) => mediaRoles[item.id] || "product"));
            if (!roles.has("product") || !roles.has("reference")) return message.warning(`${skill.title}需要同时提供商品图片和参考图片`);
        }
        if (!textReady) {
            openConfigDialog(true, "channels");
            message.warning("请先完成文本模型配置");
            return;
        }
        if (executionMode === "automatic" && !imageReady) {
            openConfigDialog(true, "channels");
            message.warning("自动执行需要先完成图片模型配置");
            return;
        }
        setBusy(true);
        setActivePhase("analysis");
        setRunState(null);
        if (recordUserMessage) setMessages((current) => [...current, { id: nanoid(), role: "user", text: userText, attachments: media.map((item) => item.label) }]);
        const controller = new AbortController();
        stopRef.current = controller;
        try {
            const canvasImages = canvasContext ? await resolveCanvasReferenceImages(validReferences, canvasContext.snapshot.nodes) : [];
            const imageInputs = [
                ...attachments.map((image) => ({ image, id: image.id, label: image.name })),
                ...canvasImages.map((image, index) => ({ image, id: validReferences[index]?.nodeId || image.id, label: validReferences[index]?.title || `画布图片${index + 1}` })),
            ];
            const analysisImageInputs = await Promise.all(imageInputs.map(async (item) => ({ ...item, dataUrl: await prepareImageForAnalysis(item.image.dataUrl) })));
            if (controller.signal.aborted) return;
            const revision = plan ? `\n这是当前方案，请根据用户的新要求修改后返回完整 JSON。${revisionTargets.length ? `用户指定修改第 ${revisionTargets.map((index) => index + 1).join("、")} 张，只修改这些画面，其他画面保持原样。` : "保留不需要修改的内容。"}\n${JSON.stringify(planForApi(plan))}` : "";
            const priorContext = messages.slice(-6).map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.text}`).join("\n");
            const content: AiTextMessage["content"] = [
                { type: "text", text: `当前技能：${skill.title}\n${skill.id === "buyer" ? `买家秀创作模式：${buyerModeLabel((brief.buyerMode as BuyerMode) || "multi-scene")}\n` : skill.id === "competitor" ? `竞品复刻方向：${competitorModeLabel((brief.competitorMode as CompetitorMode) || "composition")}\n` : ""}${formatSkillBrief(skill, brief)}技能规则：${skill.planningGuide}${formatSkillPackageRules(skill)}\n已有对话：\n${priorContext || "无"}\n预设生成张数：${requestedCount} 张，必须严格返回 ${requestedCount} 个 items。\n预设画面比例：${ratio}，除非为 auto，否则所有 items 的 ratio 必须使用该比例。\n用户当前要求：${userText}${revision}` },
                ...analysisImageInputs.flatMap(({ dataUrl, id, label }, index) => [
                    { type: "text" as const, text: `图片${index + 1}｜${mediaRoles[id] === "reference" ? "竞品参考" : "我的商品"}｜${label}` },
                    { type: "image_url" as const, image_url: { url: dataUrl } },
                ]),
            ];
            const response = await requestImageQuestion(textConfig, [{ role: "system", content: planSystemPrompt }, { role: "user", content }], () => undefined, { signal: controller.signal });
            const parsed = parsePlanResponse(response);
            if ("questions" in parsed) {
                setMessages((current) => [...current, { id: nanoid(), role: "assistant", text: parsed.questions.join("\n") }]);
                setPrompt("");
                return;
            }
            const preparedPlan = applyPlanPreferences(parsed, requestedCount, ratio);
            const nextPlan = plan ? mergePlanRevision(plan, preparedPlan, revisionTargets) : preparedPlan;
            setPlan(nextPlan);
            if (skill.id === "hero") setHeroStage(executionMode === "automatic" ? "results" : "analysis");
            if (skill.id === "detail") setDetailStage(executionMode === "automatic" ? "results" : "analysis");
            if (skill.id === "buyer") setBuyerStage(executionMode === "automatic" ? "results" : "analysis");
            if (skill.id === "competitor") setCompetitorStage(executionMode === "automatic" ? "results" : "analysis");
            setPrompt("");
            if (executionMode === "automatic") {
                const targetIds = revisionTargets.map((index) => nextPlan.items[index]?.id).filter((id): id is string => Boolean(id));
                window.setTimeout(() => { void execute(nextPlan, targetIds.length ? targetIds : undefined); }, 0);
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                const text = error instanceof Error ? error.message : "方案生成失败";
                setMessages((current) => [...current, { id: nanoid(), role: "error", text, phase: "analysis", model: textConfig.model, endpoint: apiEndpointLabel(textConfig.baseUrl), retry: "analysis" }]);
            }
        } finally {
            stopRef.current = null;
            setBusy(false);
            setActivePhase(null);
        }
    };

    const execute = async (targetPlan = plan, onlyItemIds?: string | string[]) => {
        if (!targetPlan || !skill || executionMode === "plan") return;
        const requestedIds = typeof onlyItemIds === "string" ? [onlyItemIds] : onlyItemIds;
        const selected = targetPlan.items.filter((item) => requestedIds?.length ? requestedIds.includes(item.id) : item.selected);
        if (!selected.length) return message.warning("请至少选择一个要生成的画面");
        if (!imageReady) {
            openConfigDialog(true, "channels");
            message.warning("请先完成图片模型配置");
            return;
        }
        const canvasContext = useAgentStore.getState().canvasContext;
        if (!canvasContext) return message.warning("当前画布尚未准备好");
        setBusy(true);
        setActivePhase("generation");
        if (skill.id === "hero") setHeroStage("results");
        if (skill.id === "detail") setDetailStage("results");
        if (skill.id === "buyer") setBuyerStage("results");
        if (skill.id === "competitor") setCompetitorStage("results");
        const controller = new AbortController();
        stopRef.current = controller;
        setRunState({ current: 0, total: selected.length, failed: 0 });
        const temporaryNodeIds: string[] = [];
        try {
            const snapshot = useAgentStore.getState().canvasContext?.snapshot || canvasContext.snapshot;
            const right = snapshot.nodes.length ? Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + 100 : 0;
            const top = snapshot.nodes.length ? Math.min(...snapshot.nodes.map((node) => node.position.y)) : 0;
            const boardItems = targetPlan.items.filter((entry) => Boolean(entry.outputNodeId) || selected.some((item) => item.id === entry.id));
            const layout = resultBoardLayout(boardItems, skill.id);
            const resolvedOutputIds = new Map(targetPlan.items.filter((entry) => entry.outputNodeId).map((entry) => [entry.id, entry.outputNodeId!]));
            const groupId = targetPlan.resultGroupId && snapshot.nodes.some((node) => node.id === targetPlan.resultGroupId) ? targetPlan.resultGroupId : `commerce-results-${nanoid()}`;
            const boardTitle = skill.id === "detail" ? `详情页顺序画板 · ${targetPlan.title}` : `AI 结果画板 · ${targetPlan.title}`;
            if (groupId !== targetPlan.resultGroupId) {
                canvasContext.applyOps([{ type: "add_node", id: groupId, nodeType: CanvasNodeType.Group, title: boardTitle, position: { x: right, y: top }, width: layout.width, height: layout.height, metadata: { status: "success", visualStyle: "result-board" } }]);
                setPlan((current) => current ? { ...current, resultGroupId: groupId } : current);
            } else canvasContext.applyOps([{ type: "update_node", id: groupId, patch: { title: boardTitle, width: layout.width, height: layout.height }, metadata: { visualStyle: "result-board" } }]);
            const group = (useAgentStore.getState().canvasContext?.snapshot.nodes || []).find((node) => node.id === groupId) || { position: { x: right, y: top } };
            const tempX = group.position.x + layout.width + 1200;
            const attachmentOps = attachments.map((item, index) => {
                const size = fitNodeSize(item.width || 1, item.height || 1, 260, 260);
                return { type: "add_node" as const, id: `commerce-source-${nanoid()}`, sourceId: item.id, nodeType: CanvasNodeType.Image, title: `${mediaRoles[item.id] === "reference" ? "竞品参考" : "我的商品"} · ${item.name}`, position: { x: tempX, y: top + index * 290 }, width: size.width, height: size.height, metadata: { content: item.dataUrl, status: "success" as const, naturalWidth: item.width, naturalHeight: item.height, bytes: item.size, mimeType: item.type } };
            });
            temporaryNodeIds.push(...attachmentOps.map((op) => op.id));
            if (attachmentOps.length) canvasContext.applyOps(attachmentOps);
            const sourceIds = [...references.map((item) => item.nodeId), ...attachmentOps.map((op) => op.id)];
            const roleGuide = sourceIds.map((id, index) => {
                const sourceId = index < references.length ? references[index].nodeId : attachmentOps[index - references.length].sourceId;
                return `参考图片${index + 1}是${mediaRoles[sourceId] === "reference" ? "竞品参考，只用于借鉴当前指定的视觉方法；最终画面不得出现该竞品商品、包装、Logo、商标、原文案、专属图案、人物面孔或可识别 IP" : "我的商品，是最终画面的唯一商品主体，必须保持外观、比例、颜色、材质、标签位置、结构和配件一致"}`;
            }).join("；");
            const identityGuide = targetPlan.productAnalysis.identityLock.length ? `商品身份锁定：${targetPlan.productAnalysis.identityLock.join("；")}` : "保持参考商品的造型、结构、颜色、图案和关键细节一致";
            const unknownGuide = targetPlan.productAnalysis.unknownFacts.length ? `不得表现或暗示以下未确认信息：${targetPlan.productAnalysis.unknownFacts.join("；")}` : "不得增加未确认的参数、认证、效果或配件";
            let failed = 0;
            let completed = 0;
            for (let index = 0; index < selected.length; index += 1) {
                if (controller.signal.aborted) break;
                const item = selected[index];
                const textId = `commerce-prompt-${nanoid()}`;
                const configId = `commerce-config-${nanoid()}`;
                temporaryNodeIds.push(textId, configId);
                const planIndex = targetPlan.items.findIndex((entry) => entry.id === item.id);
                const resultIndex = boardItems.findIndex((entry) => entry.id === item.id);
                const y = top + index * 390;
                const copyGuide = skill.id === "buyer" ? `配套内容草稿：\"${item.copy}\"。该文案仅供画面外发布使用，画面中不要添加任何文字、排版或水印，商品本身已有标签除外。` : item.copy ? `画面文案仅使用：\"${item.copy}\"，不要添加其他文字。` : "画面中不要添加文字、Logo 或水印，商品本身已有标签除外。";
                const promptText = `${item.prompt}\n\n${identityGuide}。\n${unknownGuide}。\n${copyGuide}\n${roleGuide}`;
                const tokens = [`@[node:${textId}]`, ...sourceIds.map((id) => `@[node:${id}]`)].join("\n");
                const ops = [
                    { type: "add_node" as const, id: textId, nodeType: CanvasNodeType.Text, title: item.title, position: { x: tempX + 340, y }, width: 300, height: 220, metadata: { content: promptText, status: "success" as const, fontSize: 14 } },
                    { type: "add_node" as const, id: configId, nodeType: CanvasNodeType.Config, title: `${skill.title} · ${item.title}`, position: { x: tempX + 700, y }, width: 360, height: 300, metadata: { generationMode: "image" as const, composerContent: tokens, prompt: tokens, status: "idle" as const, model: imageConfig.model, size: item.ratio || imageConfig.size, quality: imageConfig.quality, count: 1 } },
                    { type: "connect_nodes" as const, fromNodeId: textId, toNodeId: configId },
                    ...sourceIds.map((fromNodeId) => ({ type: "connect_nodes" as const, fromNodeId, toNodeId: configId })),
                    { type: "select_nodes" as const, ids: [configId] },
                    { type: "run_generation" as const, nodeId: configId, mode: "image" as const, prompt: tokens },
                ];
                setPlan((current) => current ? { ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, status: "loading" } : entry) } : current);
                canvasContext.applyOps(ops);
                const result = await waitForCanvasGeneration(configId, controller.signal);
                completed += 1;
                if (result.status === "error") failed += 1;
                const resultCell = resultCellPosition(resultIndex, boardItems.length, group.position, layout);
                const cleanupIds = [textId, configId];
                let outputNodeId = targetPlan.items.find((entry) => entry.id === item.id)?.outputNodeId;
                let errorDetails: string | undefined;
                if (result.nodeId) {
                    const liveNodes = useAgentStore.getState().canvasContext?.snapshot.nodes || [];
                    const resultNode = liveNodes.find((node) => node.id === result.nodeId);
                    const oldNode = outputNodeId ? liveNodes.find((node) => node.id === outputNodeId) : undefined;
                    errorDetails = resultNode?.metadata?.errorDetails;
                    if (result.status === "success" && resultNode && oldNode && oldNode.id !== resultNode.id) {
                        const versions = mergeImageVersions(oldNode, resultNode);
                        const primary = versions[versions.length - 1];
                        const size = primary ? fitNodeSize(primary.naturalWidth, primary.naturalHeight, layout.imageWidth, layout.imageHeight) : { width: oldNode.width, height: oldNode.height };
                        const resultPosition = centerResultInCell(resultCell, layout, size);
                        canvasContext.applyOps([
                            { type: "update_node", id: oldNode.id, patch: { title: resultItemTitle(skill.id, planIndex, item.title), position: resultPosition, ...size }, metadata: { ...resultNode.metadata, groupId, images: versions, count: versions.length, primaryImageId: primary?.id } },
                            { type: "delete_node", id: resultNode.id },
                            { type: "delete_node", ids: cleanupIds },
                        ]);
                        outputNodeId = oldNode.id;
                    } else if (result.status === "error" && oldNode && oldNode.id !== result.nodeId) {
                        canvasContext.applyOps([{ type: "delete_node", id: result.nodeId }, { type: "delete_node", ids: cleanupIds }]);
                    } else {
                        const resultSize = resultNode?.metadata?.naturalWidth && resultNode.metadata.naturalHeight ? fitNodeSize(resultNode.metadata.naturalWidth, resultNode.metadata.naturalHeight, layout.imageWidth, layout.imageHeight) : { width: layout.imageWidth, height: layout.imageHeight };
                        const resultPosition = centerResultInCell(resultCell, layout, resultSize);
                        canvasContext.applyOps([{ type: "update_node", id: result.nodeId, patch: { title: resultItemTitle(skill.id, planIndex, item.title), position: resultPosition, ...resultSize }, metadata: { groupId } }, { type: "delete_node", ids: cleanupIds }]);
                        outputNodeId = result.nodeId;
                    }
                } else canvasContext.applyOps([{ type: "delete_node", ids: cleanupIds }]);
                if (outputNodeId) resolvedOutputIds.set(item.id, outputNodeId);
                else if (result.status === "error" && !oldNode) resolvedOutputIds.delete(item.id);
                setPlan((current) => current ? { ...current, resultGroupId: groupId, items: current.items.map((entry) => entry.id === item.id ? { ...entry, status: result.status, outputNodeId: outputNodeId || entry.outputNodeId, errorDetails: result.status === "error" ? requestErrorSummary(errorDetails || "图片生成失败", "generation") : undefined } : entry) } : current);
                setRunState({ current: completed, total: selected.length, failed });
            }
            const finalItems = targetPlan.items.filter((entry) => resolvedOutputIds.has(entry.id));
            const finalLayout = resultBoardLayout(finalItems, skill.id);
            const finalNodes = useAgentStore.getState().canvasContext?.snapshot.nodes || [];
            const reflowOps = finalItems.flatMap((entry, resultIndex) => {
                const nodeId = resolvedOutputIds.get(entry.id);
                const node = finalNodes.find((candidate) => candidate.id === nodeId);
                if (!node) return [];
                const planIndex = targetPlan.items.findIndex((candidate) => candidate.id === entry.id);
                const cell = resultCellPosition(resultIndex, finalItems.length, group.position, finalLayout);
                return [{ type: "update_node" as const, id: node.id, patch: { title: resultItemTitle(skill.id, planIndex, entry.title), position: centerResultInCell(cell, finalLayout, node) } }];
            });
            if (finalItems.length) {
                canvasContext.applyOps([{ type: "update_node", id: groupId, patch: { width: finalLayout.width, height: finalLayout.height } }, ...reflowOps, { type: "delete_node", ids: attachmentOps.map((op) => op.id) }, { type: "select_nodes", ids: [groupId] }]);
            } else {
                canvasContext.applyOps([{ type: "delete_node", id: groupId }, { type: "delete_node", ids: attachmentOps.map((op) => op.id) }, { type: "select_nodes", ids: [] }]);
                setPlan((current) => current?.resultGroupId === groupId ? { ...current, resultGroupId: undefined } : current);
            }
            if (!controller.signal.aborted) setMessages((current) => [...current, { id: nanoid(), role: "assistant", text: `已将 ${completed} 个画面整理到同一个结果画板${failed ? `，其中 ${failed} 个生成失败` : ""}。你可以在下方修改任意提示词，并只重新生成对应图片。` }]);
        } catch (error) {
            if (!controller.signal.aborted) {
                const text = error instanceof Error ? error.message : "执行生成任务失败";
                setMessages((current) => [...current, { id: nanoid(), role: "error", text, phase: "generation", model: imageConfig.model, endpoint: apiEndpointLabel(imageConfig.baseUrl), retry: "generation" }]);
            }
        } finally {
            if (temporaryNodeIds.length) useAgentStore.getState().canvasContext?.applyOps([{ type: "delete_node", ids: temporaryNodeIds }]);
            stopRef.current = null;
            setBusy(false);
            setActivePhase(null);
        }
    };

    const currentTask = (): CommerceAssistantTask => ({ id: activeTaskId, title: taskName || "未命名任务", updatedAt: Date.now(), skillId, prompt, messages, plan, ratio, count, executionMode, brief, attachments, references, mediaRoles, heroStage, detailStage, buyerStage, competitorStage });
    const saveTaskRecords = (activeId: string, records: CommerceAssistantTask[]) => {
        const sorted = [...records].sort((a, b) => b.updatedAt - a.updatedAt);
        setTaskRecords(sorted);
        if (projectId) void saveCommerceAssistant(projectId, { version: 4, activeTaskId: activeId, tasks: sorted });
    };
    const switchTask = (taskId: string) => {
        if (busy || taskId === activeTaskId) return;
        const target = taskRecords.find((task) => task.id === taskId);
        if (!target) return;
        const records = [currentTask(), ...taskRecords.filter((task) => task.id !== activeTaskId)];
        saveTaskRecords(taskId, records);
        applyTask(target, true);
        setHistoryOpen(false);
    };
    const renameTask = (task: CommerceAssistantTask) => {
        let nextTitle = task.title;
        modal.confirm({ title: "重命名任务", content: <Input className="mt-3" defaultValue={task.title} autoFocus onChange={(event) => { nextTitle = event.target.value; }} />, okText: "保存", cancelText: "取消", onOk: () => {
            const title = nextTitle.trim() || "未命名任务";
            const records = taskRecords.map((item) => item.id === task.id ? { ...item, title, updatedAt: Date.now() } : item);
            if (task.id === activeTaskId) setTaskName(title);
            saveTaskRecords(activeTaskId, records);
        } });
    };
    const deleteTask = (task: CommerceAssistantTask) => modal.confirm({ title: `删除“${task.title}”？`, content: "只会删除右侧任务记录，画布中已经生成的图片仍会保留。", okText: "删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: () => {
        const remaining = taskRecords.filter((item) => item.id !== task.id);
        if (task.id !== activeTaskId) return saveTaskRecords(activeTaskId, remaining);
        if (remaining.length) {
            applyTask(remaining[0], true);
            saveTaskRecords(remaining[0].id, remaining);
        } else {
            const nextId = nanoid();
            setActiveTaskId(nextId);
            setTaskName("未命名任务");
            setSkillId(null);
            setPlan(null);
            setMessages([]);
            setPrompt("");
            setRunState(null);
            setAttachments([]);
            setReferences([]);
            setBrief({});
            setMediaRoles({});
            setHeroStage("prepare");
            setDetailStage("prepare");
            setBuyerStage("prepare");
            setCompetitorStage("prepare");
            saveTaskRecords(nextId, []);
        }
    } });

    const reset = () => {
        stopRef.current?.abort();
        setSkillId(null);
        setPlan(null);
        setMessages([]);
        setPrompt("");
        setRunState(null);
        setAttachments([]);
        setReferences([]);
        setBrief({});
        setMediaRoles({});
        setHeroStage("prepare");
        setDetailStage("prepare");
        setBuyerStage("prepare");
        setCompetitorStage("prepare");
    };

    const newTask = () => modal.confirm({
        title: `开始新的${skill?.title || "电商"}任务？`,
        content: "当前任务会保存到历史记录，新任务将从准备阶段开始，画布中已经生成的图片仍会保留。",
        okText: "开始新任务",
        cancelText: "取消",
        onOk: () => {
            stopRef.current?.abort();
            const records = [currentTask(), ...taskRecords.filter((task) => task.id !== activeTaskId)];
            const nextId = nanoid();
            setActiveTaskId(nextId);
            setTaskName(skill?.title || "未命名任务");
            setPlan(null);
            setMessages([]);
            setPrompt("");
            setRunState(null);
            setAttachments([]);
            setReferences([]);
            setBrief(skill?.id === "buyer" ? { buyerMode: "multi-scene" } : skill?.id === "competitor" ? { competitorMode: "composition" } : {});
            setMediaRoles({});
            setHeroStage("prepare");
            setDetailStage("prepare");
            setBuyerStage("prepare");
            setCompetitorStage("prepare");
            if (skill?.defaultRatio) setRatio(skill.defaultRatio);
            if (skill?.defaultCount) setCount(skill.defaultCount);
            saveTaskRecords(nextId, records);
        },
    });

    return (
        <div className="flex h-full min-h-0 flex-col" style={{ color: theme.node.text }}>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: theme.node.stroke }}>
                {skill ? <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} onClick={reset} /> : <span className="grid size-8 place-items-center"><Bot className="size-5 text-fuchsia-500" /></span>}
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{skill ? skill.title : creationType === "image" ? "图片生成" : creationType === "video" ? "视频生成" : "电商 AI 助手"}</div><div className="truncate text-[11px]" style={{ color: theme.node.muted }}>{activePhase === "analysis" ? "正在分析商品并整理方案" : activePhase === "generation" ? "正在生成并整理图片" : skill ? `${skill.description} · ${skill.id.startsWith("custom:") ? "我的技能" : "内置技能"}` : creationType === "agent" ? "选择技能开始创作" : "单次生成 · 无对话上下文 · 结果进入当前画布"}</div></div>
                <Button type="text" className="!px-2 !text-sm" icon={<History className="size-4" />} disabled={busy} onClick={() => setHistoryOpen(true)}>历史对话</Button>
                <Tooltip title="技能库"><Button type="text" shape="circle" icon={<BookOpen className="size-5" />} disabled={busy} onClick={() => setSkillsOpen(true)} /></Tooltip>
                {skill ? <Tooltip title={`新建${skill.title}任务`}><Button type="text" shape="circle" icon={<Plus className="size-4" />} disabled={busy} onClick={newTask} /></Tooltip> : null}
                <Tooltip title="连接本地 Codex Agent"><Button type="text" size="small" onClick={onOpenLocalAgent}>高级</Button></Tooltip>
            </div>

            {!skill ? (
                <>{creationType === "agent" ? <Welcome theme={theme} onChoose={(item) => chooseSkill(item, Boolean(prompt.trim()))} onOpenAll={() => setSkillsOpen(true)} /> : <div className="min-h-0 flex-1" />}<div className="shrink-0 px-2 pb-2"><div className="rounded-[24px] border p-5 shadow-lg [&_.ant-btn-circle]:!size-11 [&_.ant-select-selector]:!min-h-10" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>{creationType !== "agent" ? <div className="mb-2 flex items-center justify-between rounded-xl px-2 py-1.5 text-[11px]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}><span>图片与视频模式无对话上下文，参考素材请单独上传</span><X className="size-3.5 cursor-pointer" onClick={() => chooseCreationType("agent")} /></div> : null}{creationType === "video" ? <DirectVideoMediaBar capabilities={videoCapabilities} imageCount={attachments.length + references.length} videos={directMedia.filter((item) => item.kind === "video")} audios={directMedia.filter((item) => item.kind === "audio")} theme={theme} onImage={() => fileInputRef.current?.click()} onVideo={() => videoInputRef.current?.click()} onAudio={() => audioInputRef.current?.click()} onAsset={(kind) => openAssetPicker(kind === "video" ? "video" : "product")} onRemove={(id) => setDirectMedia((current) => current.filter((item) => item.id !== id))} /> : <ComposerMediaBar attachments={attachments} references={references} theme={theme} onUpload={() => { uploadRoleRef.current = "product"; fileInputRef.current?.click(); }} onAsset={() => openAssetPicker()} onReference={(next) => updateCanvasReferences(next, "product")} onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))} onRemoveReference={(id) => setReferences((current) => current.filter((item) => item.nodeId !== id))} />}<MentionPicker open={creationType === "agent" && mentionOpen} query={mentionQuery(prompt)} skills={allSkills} theme={theme} onOpenChange={setMentionOpen} onSkill={chooseMentionSkill}><Input.TextArea className="!text-[17px] !leading-8" value={prompt} autoSize={{ minRows: 3, maxRows: 6 }} variant="borderless" placeholder={creationType === "image" ? "描述你想要生成的图片细节…" : creationType === "video" ? "描述你想要生成的视频场景…" : "描述你的需求，输入 @ 选择技能…"} onChange={(event) => { setPrompt(event.target.value); if (creationType === "agent") setMentionOpen(hasMentionQuery(event.target.value)); }} /></MentionPicker><div className="mt-2 flex items-center justify-between"><div className="flex min-w-0 items-center gap-1"><input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /><input ref={videoInputRef} hidden type="file" accept="video/*" multiple onChange={(event) => { void addDirectMedia(event.target.files, "video"); event.target.value = ""; }} /><input ref={audioInputRef} hidden type="file" accept="audio/*" multiple onChange={(event) => { void addDirectMedia(event.target.files, "audio"); event.target.value = ""; }} /><CreationTypePopover value={creationType} theme={theme} onChange={chooseCreationType} />{creationType !== "video" ? <GenerationSettingsPopover ratio={ratio} count={count} disabled={busy} theme={theme} onRatioChange={setRatio} onCountChange={changeGenerationCount} /> : <VideoComposerControls capabilities={videoCapabilities} config={videoConfig} theme={theme} onChange={(key, value) => updateConfig(key, value)} onOpenModels={() => openConfigDialog(true, "channels")} />}{creationType === "agent" ? <><Tooltip title="技能库"><Button type="text" shape="circle" icon={<BookOpen className="size-5" />} onClick={() => setSkillsOpen(true)} /></Tooltip><Tooltip title="@ 选择技能"><Button type="text" shape="circle" icon={<span className="text-base font-semibold">@</span>} onClick={() => setMentionOpen(true)} /></Tooltip><ExecutionModeSelect value={executionMode} disabled={busy} onChange={(value) => { setExecutionMode(value); localStorage.setItem("commerce-assistant-execution-mode", value); }} /></> : null}</div><Button type="primary" shape="circle" icon={<ArrowUp className="size-5" />} disabled={!prompt.trim() && !attachments.length && !references.length} onClick={runDirectGeneration} /></div></div></div></>
            ) : (
                <>
                    <div ref={conversationScrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
                        {plan ? <div className="mb-4 flex items-center gap-2 px-1 text-sm" style={{ color: theme.node.muted }}><span className="size-1.5 rounded-full bg-fuchsia-500" /><span>{workflowStatusText(skill.id, skill.id === "hero" ? heroStage : skill.id === "detail" ? detailStage : skill.id === "buyer" ? buyerStage : skill.id === "competitor" ? competitorStage : undefined)}</span></div> : null}
                        {!messages.length && skill.id !== "hero" && skill.id !== "detail" && skill.id !== "buyer" && skill.id !== "competitor" ? <SkillIntro skill={skill} theme={theme} /> : null}
                        <div className="space-y-4">
                            {messages.filter((item) => !isDuplicatePlanMessage(item, plan)).map((item) => <ChatRow key={item.id} item={item} skillTitle={skill.title} theme={theme} busy={busy} onRetry={() => item.retry === "analysis" ? void analyze(false) : item.retry === "generation" ? void execute() : undefined} onOpenConfig={() => openConfigDialog(true, "channels")} />)}
                            {activePhase === "analysis" ? <div className="flex items-center gap-2 text-sm" style={{ color: theme.node.muted }}><LoaderCircle className="size-4 animate-spin" />正在分析商品并整理方案…</div> : null}
                            {plan && (skill.id !== "hero" || heroStage !== "prepare") && (skill.id !== "detail" || detailStage !== "prepare") && (skill.id !== "buyer" || buyerStage !== "prepare") && (skill.id !== "competitor" || competitorStage !== "prepare") ? <PlanCard plan={plan} skillId={skill.id} stage={skill.id === "hero" ? heroStage : skill.id === "detail" ? detailStage : skill.id === "buyer" ? buyerStage : skill.id === "competitor" ? competitorStage : undefined} executionMode={executionMode} theme={theme} busy={busy} runState={runState} onChange={setPlan} onStageChange={(next) => skill.id === "detail" ? setDetailStage(next as DetailStage) : skill.id === "buyer" ? setBuyerStage(next as BuyerStage) : skill.id === "competitor" ? setCompetitorStage(next as CompetitorStage) : setHeroStage(next as HeroStage)} onExecute={() => void execute()} onRegenerate={(itemId) => void execute(plan, itemId)} onReferenceResult={referenceResultImage} /> : null}
                        </div>
                    </div>
                    <div className="shrink-0 px-2 pb-2">
                        <div className="rounded-[24px] border p-5 shadow-lg [&_.ant-btn-circle]:!size-11 [&_.ant-select-selector]:!min-h-10" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                            {skill.materialMode === "product-reference" ? <CompetitorMediaBar attachments={attachments} references={references} mediaRoles={mediaRoles} theme={theme} onUpload={(role) => { uploadRoleRef.current = role; fileInputRef.current?.click(); }} onAsset={openAssetPicker} onReference={updateCanvasReferences} onRoleChange={(id, role) => setMediaRoles((current) => ({ ...current, [id]: role }))} onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))} onRemoveReference={(id) => setReferences((current) => current.filter((item) => item.nodeId !== id))} /> : <ComposerMediaBar attachments={attachments} references={references} theme={theme} onUpload={() => { uploadRoleRef.current = "product"; fileInputRef.current?.click(); }} onAsset={() => openAssetPicker()} onReference={(next) => updateCanvasReferences(next, "product")} onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))} onRemoveReference={(id) => setReferences((current) => current.filter((item) => item.nodeId !== id))} />}
                            <div className="flex min-h-20 items-start rounded-xl px-1 py-2"><button type="button" className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setSkillsOpen(true)}><Sparkles className="size-4 text-fuchsia-500" />@{skill.title}</button><div className="min-w-0 flex-1"><MentionPicker open={mentionOpen} query={mentionQuery(prompt)} skills={allSkills} theme={theme} onOpenChange={setMentionOpen} onSkill={chooseMentionSkill}><Input.TextArea className="!text-[17px] !leading-8" value={prompt} disabled={busy} autoSize={{ minRows: 2, maxRows: 6 }} variant="borderless" placeholder={plan ? `告诉我需要怎样调整，我会按【${skill.title}】继续处理…` : `告诉我你的目标、素材和要求，我会按【${skill.title}】帮你处理…`} onChange={(event) => { setPrompt(event.target.value); setMentionOpen(hasMentionQuery(event.target.value)); }} onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); if (!busy) void analyze(); } }} /></MentionPicker></div></div>
                            <div className="mt-2 flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                    <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} />
                                    <CreationTypePopover value="agent" theme={theme} onChange={chooseCreationType} />
                                    <Tooltip title="技能库"><Button type="text" shape="circle" icon={<BookOpen className="size-5" />} disabled={busy} onClick={() => setSkillsOpen(true)} /></Tooltip>
                                    <Tooltip title="选择技能"><Button type="text" shape="circle" icon={<span className="text-base font-semibold">@</span>} disabled={busy} onClick={() => setMentionOpen(true)} /></Tooltip>
                                    {skill.id === "buyer" ? <BuyerModeSelect value={(brief.buyerMode as BuyerMode) || "multi-scene"} disabled={busy} onChange={(value) => { setBrief((current) => ({ ...current, buyerMode: value })); setRatio("3:4"); setCount(value === "angle-variation" ? 5 : 3); setPlan(null); setRunState(null); setMessages([]); setBuyerStage("prepare"); }} /> : null}
                                    {skill.id === "competitor" ? <CompetitorModeSelect value={(brief.competitorMode as CompetitorMode) || "composition"} disabled={busy} onChange={(value) => { setBrief((current) => ({ ...current, competitorMode: value })); setPlan(null); setRunState(null); setMessages([]); setCompetitorStage("prepare"); }} /> : null}
                                    {skill.id !== "buyer" ? <GenerationSettingsPopover ratio={ratio} count={count} disabled={busy} theme={theme} onRatioChange={setRatio} onCountChange={changeGenerationCount} /> : null}
                                    <ExecutionModeSelect value={executionMode} disabled={busy} onChange={(value) => { setExecutionMode(value); localStorage.setItem("commerce-assistant-execution-mode", value); }} />
                                </div>
                                {busy ? <Button danger shape="circle" icon={<Square className="size-5" />} onClick={() => stopRef.current?.abort()} /> : <Button type="primary" shape="circle" icon={<ArrowUp className="size-5" />} disabled={!prompt.trim() && !attachments.length && !references.length} onClick={() => void analyze()} />}
                            </div>
                        </div>
                    </div>
                </>
            )}

            <Drawer title={<span className="flex items-center gap-2 text-lg"><History className="size-5 text-fuchsia-500" />历史对话</span>} placement="right" width={420} open={historyOpen} onClose={() => setHistoryOpen(false)} styles={{ body: { display: "flex", flexDirection: "column", padding: 16 } }}>
                <Input size="large" prefix={<Search className="size-4 opacity-50" />} value={historyQuery} allowClear placeholder="搜索对话标题或技能" onChange={(event) => setHistoryQuery(event.target.value)} />
                <div className="thin-scrollbar mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">{[currentTask(), ...taskRecords.filter((item) => item.id !== activeTaskId)].filter((task) => { const taskSkill = task.skillId ? allSkills.find((item) => item.id === task.skillId) : null; return `${task.title}${taskSkill?.title || ""}`.toLowerCase().includes(historyQuery.trim().toLowerCase()); }).map((task) => { const taskSkill = task.skillId ? allSkills.find((item) => item.id === task.skillId) || null : null; const taskPlan = task.plan as CommercePlan | null; const status = taskPlan?.items.some((item) => item.outputNodeId) ? "已有结果" : taskPlan ? "方案已生成" : taskSkill ? "准备中" : "未选择技能"; return <div key={task.id} className="rounded-2xl border p-4" style={{ borderColor: task.id === activeTaskId ? "#a855f7" : theme.node.stroke, background: task.id === activeTaskId ? theme.toolbar.activeBg : "transparent" }}><button type="button" className="w-full text-left" disabled={task.id === activeTaskId} onClick={() => switchTask(task.id)}><div className="flex items-center justify-between gap-2"><span className="truncate text-base font-semibold">{task.title}</span>{task.id === activeTaskId ? <span className="shrink-0 rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-xs text-fuchsia-500">当前</span> : null}</div><div className="mt-2 text-sm" style={{ color: theme.node.muted }}>{taskSkill?.title || "电商助手"} · {status}</div><div className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}><History className="size-3.5" />{formatTaskTime(task.updatedAt)}</div></button><div className="mt-2 flex justify-end"><Button type="text" icon={<Pencil className="size-4" />} onClick={() => renameTask(task)}>重命名</Button><Button type="text" danger icon={<Trash2 className="size-4" />} onClick={() => deleteTask(task)}>删除</Button></div></div>; })}{![currentTask(), ...taskRecords.filter((item) => item.id !== activeTaskId)].filter((task) => { const taskSkill = task.skillId ? allSkills.find((item) => item.id === task.skillId) : null; return `${task.title}${taskSkill?.title || ""}`.toLowerCase().includes(historyQuery.trim().toLowerCase()); }).length ? <div className="py-16 text-center text-base" style={{ color: theme.node.muted }}>{historyQuery ? "没有匹配的历史对话" : "还没有历史对话"}</div> : null}</div>
                <Button className="mt-4 !h-12 shrink-0 !text-base" type="primary" icon={<Plus className="size-5" />} onClick={() => { setHistoryOpen(false); newTask(); }}>开始新对话</Button>
            </Drawer>
            <Modal title="技能库" open={skillsOpen} footer={null} width={620} onCancel={() => setSkillsOpen(false)}>
                <div className="mt-3 flex items-center justify-between gap-2"><div className="flex gap-1">{(["all", "system", "mine"] as const).map((tab) => <Button key={tab} type={skillTab === tab ? "primary" : "text"} size="small" onClick={() => setSkillTab(tab)}>{tab === "all" ? "全部" : tab === "system" ? "系统技能" : "我的技能"}</Button>)}</div><div className="flex gap-1"><input ref={skillFileInputRef} hidden type="file" accept=".zip,.json,.md,.txt,application/zip,application/json,text/markdown,text/plain" onChange={(event) => { void importSkillFile(event.target.files?.[0]); event.target.value = ""; }} /><Button size="small" icon={<ArrowUp className="size-3.5" />} onClick={() => skillFileInputRef.current?.click()}>导入</Button><Button type="primary" size="small" icon={<Plus className="size-3.5" />} onClick={() => openSkillEditor()}>新建技能</Button></div></div>
                <Input className="mt-3" prefix={<Search className="size-4 opacity-50" />} value={query} allowClear placeholder="搜索技能" onChange={(event) => setQuery(event.target.value)} />
                <div className="mt-3 grid max-h-[55vh] gap-2 overflow-y-auto">{filteredSkills.map((item) => <div key={item.id} className="relative"><SkillButton skill={item} theme={theme} onClick={() => chooseSkill(item, true)} /><div className="absolute right-2 top-2 flex">{item.packageInfo ? <Tooltip title="查看技能包"><Button type="text" size="small" shape="circle" icon={<Eye className="size-3.5" />} onClick={() => setPackageSkillId(item.id)} /></Tooltip> : null}<Tooltip title="导出技能"><Button type="text" size="small" shape="circle" icon={<Download className="size-3.5" />} onClick={() => exportSkill(item)} /></Tooltip><Tooltip title="复制为自定义技能"><Button type="text" size="small" shape="circle" icon={<Copy className="size-3.5" />} onClick={() => openSkillEditor(item, true)} /></Tooltip>{item.id.startsWith("custom:") ? <><Tooltip title="编辑技能"><Button type="text" size="small" shape="circle" icon={<Pencil className="size-3.5" />} onClick={() => openSkillEditor(item)} /></Tooltip><Tooltip title="删除自定义技能"><Button type="text" danger size="small" shape="circle" icon={<Trash2 className="size-3.5" />} onClick={() => removeCustomSkill(item)} /></Tooltip></> : null}</div></div>)}{!filteredSkills.length ? <div className="py-12 text-center text-sm" style={{ color: theme.node.muted }}>{skillTab === "mine" ? "还没有导入技能" : "没有匹配的技能"}</div> : null}</div>
            </Modal>
            <SkillPackageModal skill={packageSkill} theme={theme} open={Boolean(packageSkill)} onClose={() => setPackageSkillId(null)} onReferencesChange={async (paths) => { if (!packageSkill?.packageInfo) return; const next = customSkills.map((item) => item.id === packageSkill.id ? { ...item, packageInfo: { ...item.packageInfo!, enabledReferences: paths } } : item); setCustomSkills(next); await saveCommerceCustomSkills(next); }} />
            <Modal title={editingSkillId ? "编辑技能" : "新建技能"} open={skillEditorOpen} width={680} okText="保存技能" cancelText="取消" onOk={() => void saveSkillDraft()} onCancel={() => setSkillEditorOpen(false)} destroyOnHidden>
                <div className="space-y-4 pt-2"><div><div className="mb-1 text-xs">技能名称</div><Input value={skillDraft.title} placeholder="例如：小红书封面设计" onChange={(event) => setSkillDraft((current) => ({ ...current, title: event.target.value }))} /></div><div><div className="mb-1 text-xs">简短说明</div><Input value={skillDraft.description} placeholder="告诉用户这个技能能完成什么" onChange={(event) => setSkillDraft((current) => ({ ...current, description: event.target.value }))} /></div><div><div className="mb-1 text-xs">需要的图片素材</div><AntSelect className="w-full" value={skillDraft.materialMode} options={[{ value: "product", label: "仅商品图片" }, { value: "product-reference", label: "商品图片 + 参考图片" }]} onChange={(value) => setSkillDraft((current) => ({ ...current, materialMode: value }))} /></div><div><div className="mb-1 text-xs">默认任务</div><Input.TextArea value={skillDraft.defaultRequest} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="用户未填写要求时，助手默认执行的任务" onChange={(event) => setSkillDraft((current) => ({ ...current, defaultRequest: event.target.value }))} /></div><div><div className="mb-2 flex items-center justify-between"><span className="text-xs">补充信息字段（选填）</span><Button type="text" size="small" icon={<Plus className="size-3.5" />} onClick={() => setSkillDraft((current) => ({ ...current, fields: [...current.fields, { id: nanoid(), label: "", type: "text", options: "" }] }))}>添加字段</Button></div><div className="space-y-2">{skillDraft.fields.map((field) => <div key={field.id} className="rounded-xl border p-2" style={{ borderColor: theme.node.stroke }}><div className="flex gap-2"><Input size="small" value={field.label} placeholder="字段名称，例如目标人群" onChange={(event) => setSkillDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item) }))} /><AntSelect className="w-28 shrink-0" size="small" value={field.type} options={[{ value: "text", label: "文本输入" }, { value: "select", label: "选项选择" }]} onChange={(value) => setSkillDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, type: value } : item) }))} /><Button type="text" danger size="small" shape="circle" icon={<Trash2 className="size-3.5" />} onClick={() => setSkillDraft((current) => ({ ...current, fields: current.fields.filter((item) => item.id !== field.id) }))} /></div>{field.type === "select" ? <Input.TextArea className="mt-2" size="small" value={field.options} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={'每行一个选项，例如：\n淘宝 / 天猫\n京东\n小红书'} onChange={(event) => setSkillDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, options: event.target.value } : item) }))} /> : null}</div>)}{!skillDraft.fields.length ? <div className="rounded-xl border border-dashed py-4 text-center text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>没有补充字段，用户可直接在对话框描述需求</div> : null}</div></div><div><div className="mb-1 text-xs">完整工作流程</div><Input.TextArea value={skillDraft.planningGuide} autoSize={{ minRows: 8, maxRows: 16 }} placeholder="写清目标、分析步骤、生成要求、禁止事项和结果检查标准" onChange={(event) => setSkillDraft((current) => ({ ...current, planningGuide: event.target.value }))} /></div></div>
            </Modal>
            <AssetPickerModal open={assetPickerOpen} allowedKinds={[assetPickerTarget === "video" ? "video" : "image"]} onInsert={(payload) => void addAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
        </div>
    );
}

function formatTaskTime(value: number) {
    return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Welcome({ theme, onChoose, onOpenAll }: { theme: Theme; onChoose: (skill: CommerceSkill) => void; onOpenAll: () => void }) {
    return <div className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6"><div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center"><div className="mx-auto grid size-20 place-items-center rounded-2xl border" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}><Bot className="size-10 text-fuchsia-500" /></div><h2 className="mt-5 text-center text-2xl font-semibold">电商 AI 助手</h2><p className="mt-2 text-center text-base leading-7" style={{ color: theme.node.muted }}>选择一个技能，上传商品素材，助手会先给出方案，确认后再生成到画布</p><div className="mt-6 grid gap-3">{commerceSkills.map((item) => <SkillButton key={item.id} skill={item} theme={theme} onClick={() => onChoose(item)} />)}</div><button className="mx-auto mt-4 flex items-center gap-2 px-4 py-2.5 text-base" onClick={onOpenAll}><BookOpen className="size-5" />查看技能</button></div></div>;
}

type Theme = (typeof canvasThemes)[keyof typeof canvasThemes];
function SkillButton({ skill, theme, onClick }: { skill: CommerceSkill; theme: Theme; onClick: () => void }) {
    return <button type="button" className="flex min-h-16 w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-md" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }} onClick={onClick}><Sparkles className="mt-0.5 size-5 shrink-0 text-fuchsia-500" /><span className="min-w-0"><span className="block text-base font-medium">{skill.title}</span><span className="mt-1 block text-sm leading-5" style={{ color: theme.node.muted }}>{skill.description}</span>{skill.packageInfo ? <span className="mt-2 flex items-center gap-1 text-xs" style={{ color: theme.node.muted }}><Box className="size-3.5" />{packageSummary(skill)}</span> : null}</span></button>;
}
function SkillIntro({ skill, theme }: { skill: CommerceSkill; theme: Theme }) {
    return <div className="mb-5 rounded-2xl border p-4" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}><div className="flex items-center gap-2 font-medium"><Sparkles className="size-4 text-fuchsia-500" />{skill.title}</div><p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>{skill.description}。上传图片或使用 @ 引用画布素材，然后补充你的要求。</p>{skill.packageInfo ? <div className="mt-3 rounded-xl border p-3 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}><div className="flex items-center gap-1 font-medium" style={{ color: theme.node.text }}><Box className="size-4" />ZIP 技能包</div><div className="mt-1">{packageSummary(skill)}</div>{skill.packageInfo.scripts.length ? <div>已识别脚本，但不会自动执行第三方代码。</div> : null}</div> : null}</div>;
}
function packageSummary(skill: CommerceSkill) {
    const info = skill.packageInfo;
    return info ? `${info.references.length} 份参考文档 · ${info.assets.length} 个素材/模板 · ${info.scripts.length} 个脚本` : "";
}
function workflowStatusText(skillId: CommerceSkillId, stage?: WorkflowStage) {
    if (stage === "results") return "方案已提交，正在查看生成结果";
    if (stage === "analysis") return "已完成素材识别，正在确认分析结论";
    if (stage === "structure") return "需求分析已确认，正在确认页面结构";
    if (stage === "scenes") return "商品分析已确认，正在确认场景方案";
    if (stage === "migration") return "竞品拆解已确认，正在确认迁移方案";
    if (stage === "content") return skillId === "detail" ? "页面结构已确认，正在确认逐屏内容" : "方案结构已确认，正在确认内容与提示词";
    if (stage === "plan") return "商品分析已确认，正在确认主图方案";
    return "正在准备任务";
}
function SkillPackageModal({ skill, theme, open, onClose, onReferencesChange }: { skill: CommerceSkill | null; theme: Theme; open: boolean; onClose: () => void; onReferencesChange: (paths: string[]) => void | Promise<void> }) {
    const info = skill?.packageInfo;
    if (!skill || !info) return null;
    const enabled = info.enabledReferences || [];
    const toggle = (path: string, checked: boolean) => void onReferencesChange(checked ? [...enabled, path] : enabled.filter((item) => item !== path));
    const selectedCharacters = info.references.filter((item) => enabled.includes(item.path)).reduce((sum, item) => sum + item.content.length, 0);
    return <Modal title={`${skill.title} · 技能包`} open={open} footer={null} width={760} onCancel={onClose}><div className="space-y-4 pt-2"><div className="rounded-xl border p-3 text-sm" style={{ borderColor: theme.node.stroke }}><div>{packageSummary(skill)}</div><div className="mt-1 text-xs" style={{ color: theme.node.muted }}>入口：{info.entryFile} · 共 {info.fileCount} 个文件</div></div><div><div className="mb-2 flex items-center justify-between gap-3"><div><div className="text-sm font-medium">任务参考规则</div><div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>勾选的文档会在调用技能时发送给分析模型，当前约 {selectedCharacters.toLocaleString("zh-CN")} 字。</div></div><div className="flex shrink-0 gap-1"><Button type="text" size="small" onClick={() => void onReferencesChange(info.references.map((item) => item.path))}>全选</Button><Button type="text" size="small" onClick={() => void onReferencesChange([])}>清空</Button></div></div><div className="thin-scrollbar max-h-72 space-y-2 overflow-y-auto">{info.references.map((item) => <details key={item.path} className="rounded-xl border px-3 py-2" style={{ borderColor: theme.node.stroke }}><summary className="flex cursor-pointer list-none items-center gap-2"><Checkbox checked={enabled.includes(item.path)} onClick={(event) => event.stopPropagation()} onChange={(event) => toggle(item.path, event.target.checked)} /><span className="min-w-0 flex-1 truncate text-sm">{item.path.split("/").pop()}</span><span className="text-[11px]" style={{ color: theme.node.muted }}>{item.content.length.toLocaleString("zh-CN")} 字</span></summary><pre className="thin-scrollbar mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-5" style={{ color: theme.node.muted }}>{item.content}</pre></details>)}</div></div>{info.assets.length ? <details className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><summary className="cursor-pointer text-sm font-medium">素材与模板（{info.assets.length}）</summary><div className="mt-2 space-y-1 text-xs" style={{ color: theme.node.muted }}>{info.assets.map((path) => <div key={path} className="break-all">{path}</div>)}</div></details> : null}{info.scripts.length ? <details className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><summary className="cursor-pointer text-sm font-medium">脚本（{info.scripts.length}，不会自动执行）</summary><div className="mt-2 space-y-1 text-xs" style={{ color: theme.node.muted }}>{info.scripts.map((path) => <div key={path} className="break-all">{path}</div>)}</div></details> : null}</div></Modal>;
}
function HeroPreparationCard({ skill, attachments, references, brief, ratio, count, executionMode, theme }: { skill: CommerceSkill; attachments: number; references: number; brief: Record<string, string>; ratio: string; count: number; executionMode: ExecutionMode; theme: Theme }) {
    const filled = skill.fields.filter((field) => brief[field.key]?.trim()).length;
    const mode = executionMode === "automatic" ? "自动执行" : executionMode === "plan" ? "仅规划" : "确认后执行";
    return <div className="mb-4 rounded-2xl border p-5" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}><div className="text-base font-semibold">准备商品主图任务</div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>商品素材</div><div className="mt-1.5 text-base font-semibold">{attachments + references ? `${attachments + references} 张` : "待添加"}</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>需求信息</div><div className="mt-1.5 text-base font-semibold">{filled}/{skill.fields.length} 项</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>生成设置</div><div className="mt-1.5 text-base font-semibold">{ratio} · {count} 张</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>执行方式</div><div className="mt-1.5 text-base font-semibold">{mode}</div></div></div><p className="mt-4 text-sm leading-6" style={{ color: theme.node.muted }}>在下方添加商品图片和要求后发送。助手会先识别商品事实，再整理整组主图方案。</p></div>;
}
function DetailPreparationCard(props: Parameters<typeof HeroPreparationCard>[0]) {
    const { skill, attachments, references, brief, ratio, count, executionMode, theme } = props;
    const filled = skill.fields.filter((field) => brief[field.key]?.trim()).length;
    const mode = executionMode === "automatic" ? "自动执行" : executionMode === "plan" ? "仅规划" : "确认后执行";
    return <div className="mb-4 rounded-2xl border p-5" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}><div className="text-base font-semibold">准备商品详情页任务</div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>商品素材</div><div className="mt-1.5 text-base font-semibold">{attachments + references ? `${attachments + references} 张` : "待添加"}</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>需求信息</div><div className="mt-1.5 text-base font-semibold">{filled}/{skill.fields.length} 项</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>页面设置</div><div className="mt-1.5 text-base font-semibold">{ratio} · {count} 屏</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>执行方式</div><div className="mt-1.5 text-base font-semibold">{mode}</div></div></div><p className="mt-4 text-sm leading-6" style={{ color: theme.node.muted }}>先确认商品、受众、卖点证据和价格带，再规划页面结构与逐屏内容。</p></div>;
}
function detailAnalysisLabel(label: string) {
    if (/JTBD|用户洞察|痛点|痒点|爽点/i.test(label)) return "用户为什么购买、最关心什么";
    if (/核心价值|FABE|卖点/i.test(label)) return "商品凭什么解决";
    if (/合规|证据|风险/i.test(label)) return "当前缺少什么证据";
    if (/阅读|动线|AIDA/i.test(label)) return "页面怎样推进购买决策";
    if (/品类|渠道|诊断/i.test(label)) return "商品与销售渠道判断";
    return label;
}
function BuyerPreparationCard(props: Parameters<typeof HeroPreparationCard>[0]) {
    const { skill, attachments, references, brief, ratio, count, executionMode, theme } = props;
    const filled = skill.fields.filter((field) => brief[field.key]?.trim()).length;
    const mode = (brief.buyerMode as BuyerMode) || "multi-scene";
    const modeInfo = mode === "same-scene" ? "同场景组图：固定商品、房间、人物与光线，只改变机位、距离和使用状态" : mode === "angle-variation" ? "视角裂变：固定参考图主体、场景和氛围，只扩展不同拍摄视角" : "多场景：围绕不同真实使用任务设计多种生活情境";
    const execution = executionMode === "automatic" ? "自动执行" : executionMode === "plan" ? "仅规划" : "确认后执行";
    return <div className="mb-4 rounded-2xl border p-5" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}><div className="text-base font-semibold">准备买家秀任务</div><p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>{modeInfo}</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>商品素材</div><div className="mt-1.5 text-base font-semibold">{attachments + references ? `${attachments + references} 张` : "待添加"}</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>需求信息</div><div className="mt-1.5 text-base font-semibold">{filled}/{skill.fields.length} 项</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>生成设置</div><div className="mt-1.5 text-base font-semibold">{ratio} · {count} 张</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>执行方式</div><div className="mt-1.5 text-base font-semibold">{execution}</div></div></div></div>;
}
function buyerAnalysisLabel(label: string) {
    if (/人物|任务/i.test(label)) return "谁在使用、为什么使用";
    if (/场景矩阵/i.test(label)) return "真实使用场景";
    if (/一致性锚点/i.test(label)) return "整组需要保持不变的内容";
    if (/摄影|真实感/i.test(label)) return "手机随手拍规则";
    if (/互动|身份锁定/i.test(label)) return "商品如何被真实使用";
    if (/可信度|风险/i.test(label)) return "需要避免的虚假与穿帮";
    return label;
}
function BuyerResultChecklist({ theme }: { theme: Theme }) {
    const checks = [
        ["商品准确性", "颜色、形态、材质、标识、比例和配件是否与参考商品一致"],
        ["画面合理性", "商品是否有合理支撑、接触阴影，是否存在悬浮、穿插或比例异常"],
        ["生活真实性", "是否具有真实使用状态、生活痕迹和手机随手拍感觉"],
        ["组图一致性", "同场景模式下的房间、人物、光线和拍摄风格是否保持一致"],
    ];
    return <div className="mt-3 rounded-2xl border p-4" style={{ borderColor: theme.node.stroke }}><div className="text-base font-semibold">整组结果检查</div><div className="mt-3 space-y-3">{checks.map(([title, text]) => <div key={title} className="flex gap-2 text-sm leading-6"><Check className="mt-1 size-4 shrink-0 text-emerald-500" /><div><span className="font-medium">{title}：</span><span style={{ color: theme.node.muted }}>{text}</span></div></div>)}</div><p className="mt-3 text-xs leading-5" style={{ color: theme.node.muted }}>检查不通过时修改对应图片提示词，再单独重新生成该图。</p></div>;
}
function CompetitorPreparationCard({ skill, attachments, references, mediaRoles, brief, ratio, count, executionMode, theme }: { skill: CommerceSkill; attachments: AgentAttachment[]; references: CanvasResourceReference[]; mediaRoles: Record<string, MediaRole>; brief: Record<string, string>; ratio: string; count: number; executionMode: ExecutionMode; theme: Theme }) {
    const productCount = [...attachments.map((item) => item.id), ...references.map((item) => item.nodeId)].filter((id) => (mediaRoles[id] || "product") === "product").length;
    const referenceCount = [...attachments.map((item) => item.id), ...references.map((item) => item.nodeId)].filter((id) => mediaRoles[id] === "reference").length;
    const filled = skill.fields.filter((field) => brief[field.key]?.trim()).length;
    const mode = competitorModeLabel((brief.competitorMode as CompetitorMode) || "composition");
    const execution = executionMode === "automatic" ? "自动执行" : executionMode === "plan" ? "仅规划" : "确认后执行";
    return <div className="mb-4 rounded-2xl border p-5" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}><div className="text-base font-semibold">准备竞品复刻任务</div><p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>{mode}</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>我的商品</div><div className="mt-1.5 text-base font-semibold">{productCount ? `${productCount} 张` : "待添加"}</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>竞品参考</div><div className="mt-1.5 text-base font-semibold">{referenceCount ? `${referenceCount} 张` : "待添加"}</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>生成设置</div><div className="mt-1.5 text-base font-semibold">{ratio} · {count} 张</div></div><div className="rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}><div style={{ color: theme.node.muted }}>需求与执行</div><div className="mt-1.5 text-base font-semibold">{filled}/{skill.fields.length} 项 · {execution}</div></div></div><p className="mt-4 text-sm leading-6" style={{ color: theme.node.muted }}>助手会先拆解参考图，再说明如何迁移到你的商品；竞品商品、品牌、文案和专属元素不会进入最终画面。</p></div>;
}
function competitorAnalysisLabel(label: string) {
    if (/视觉拆解/i.test(label)) return "参考图使用了什么视觉方法";
    if (/可复用/i.test(label)) return "哪些方法可以借鉴";
    if (/替换映射/i.test(label)) return "参考元素如何替换为我的商品";
    if (/主动差异/i.test(label)) return "最终画面如何形成明显差异";
    if (/品牌|IP|事实|风险/i.test(label)) return "需要排除的品牌、版权与事实风险";
    return label;
}
function CompetitorResultChecklist({ theme }: { theme: Theme }) {
    const checks = [["商品一致性", "最终画面是否只使用我的商品，并保持颜色、结构、材质、标签和配件一致"], ["竞品残留", "是否残留竞品商品、包装、Logo、商标、文字、图案或人物面孔"], ["构图适配", "参考方法是否已根据我的商品比例和真实用法重新计算"], ["主动差异", "视角、位置、道具、背景、色彩或光线是否形成可见差异"], ["事实风险", "是否加入未经确认的参数、认证、功效、配件或宣传结论"]];
    return <div className="mt-3 rounded-2xl border p-4" style={{ borderColor: theme.node.stroke }}><div className="text-base font-semibold">复刻结果检查</div><div className="mt-3 space-y-3">{checks.map(([title, text]) => <div key={title} className="flex gap-2 text-sm leading-6"><ShieldCheck className="mt-1 size-4 shrink-0 text-emerald-500" /><div><span className="font-medium">{title}：</span><span style={{ color: theme.node.muted }}>{text}</span></div></div>)}</div><p className="mt-3 text-xs leading-5" style={{ color: theme.node.muted }}>发现残留或商品跑偏时，修改对应提示词后只重新生成该图。</p></div>;
}
function ChatRow({ item, skillTitle, theme, busy, onRetry, onOpenConfig }: { item: ChatItem; skillTitle: string; theme: Theme; busy: boolean; onRetry: () => void; onOpenConfig: () => void }) {
    if (item.role === "user") return <div className="ml-10"><div className="rounded-2xl px-4 py-3 text-left text-sm leading-6" style={{ background: theme.toolbar.activeBg }}><div className="mb-1 flex flex-wrap items-center gap-1.5 font-semibold text-fuchsia-500"><BookOpen className="size-3.5" />{skillTitle}{item.attachments?.map((name, index) => <span key={`${index}-${name}`} className="inline-flex max-w-36 items-center gap-1 truncate rounded-md px-2 py-0.5 text-xs font-normal" style={{ background: theme.toolbar.panel, color: theme.node.muted }}><ImagePlus className="size-3 shrink-0" />{name}</span>)}</div><div className="whitespace-pre-wrap">{item.text}</div></div></div>;
    if (item.role === "assistant") return <div className="mr-4 whitespace-pre-wrap text-sm leading-6">{item.text}</div>;
    const advice = requestErrorAdvice(item.text);
    const summary = requestErrorSummary(item.text, item.phase);
    return <div className="mr-4 rounded-2xl border p-4 text-sm" style={{ borderColor: "#ef444466", background: "#ef44440a" }}><div className="text-base font-semibold text-red-500">{item.phase === "generation" ? "图片生成未完成" : "方案分析未完成"}</div><div className="mt-2 leading-6">{summary}</div><div className="mt-2 leading-6" style={{ color: theme.node.muted }}>{advice}</div>{summary !== item.text || item.model || item.endpoint ? <details className="mt-2"><summary className="cursor-pointer text-xs" style={{ color: theme.node.muted }}>查看技术信息</summary><div className="mt-2 break-all whitespace-pre-wrap rounded-lg p-2 text-xs leading-5" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>{item.text}{item.model || item.endpoint ? `\n\n${item.model ? `模型：${item.model}` : ""}${item.model && item.endpoint ? " · " : ""}${item.endpoint ? `接口：${item.endpoint}` : ""}` : ""}</div></details> : null}<div className="mt-3 flex flex-wrap gap-2"><Button icon={<RotateCcw className="size-4" />} disabled={busy || !item.retry} onClick={onRetry}>重新尝试</Button><Button type="text" icon={<Settings2 className="size-4" />} disabled={busy} onClick={onOpenConfig}>检查模型配置</Button></div></div>;
}

function isDuplicatePlanMessage(item: ChatItem, plan: CommercePlan | null) {
    if (!plan || item.role !== "assistant") return false;
    const text = item.text.trim();
    return text === `${plan.summary}\n\n${plan.strategy}`.trim() || Boolean(plan.summary && plan.strategy && text.startsWith(plan.summary) && text.includes(plan.strategy));
}

function apiEndpointLabel(baseUrl: string) {
    try { return new URL(baseUrl).host || baseUrl; } catch { return baseUrl.replace(/^https?:\/\//, "").split("/")[0] || "未配置"; }
}

function requestErrorAdvice(text: string) {
    if (/413|entity too large|体积过大/i.test(text)) return "分析素材的请求体仍超过接口限制。原图和当前方案已保留，请减少本次参考图片后直接重试。";
    if (/502|网关|bad gateway/i.test(text)) return "接口已收到请求，但上游模型暂时不可用。稍后重试，持续失败时请在配置中更换该能力对应的模型。";
    if (/401|403|api key|鉴权|unauthorized|forbidden/i.test(text)) return "请检查密钥是否有效，以及当前密钥是否拥有这个模型的调用权限。";
    if (/429|限流|额度|quota|rate limit/i.test(text)) return "当前额度不足或请求过快，请检查账户额度后再重试。";
    if (/failed to fetch|network|请求失败/i.test(text)) return "浏览器没有拿到接口响应，请检查本地代理是否运行、代理地址以及接口跨域设置。";
    return "当前素材、方案和提示词都已保留，可以检查模型配置后直接重试。";
}

function requestErrorSummary(text: string, phase?: "analysis" | "generation") {
    if (/413|entity too large|content too large|体积过大/i.test(text)) return "参考素材超过当前接口可处理的大小，请减少图片数量后重试。";
    if (/401|403|api key|鉴权|unauthorized|forbidden/i.test(text)) return "当前模型授权不可用，请检查密钥和模型权限。";
    if (/429|限流|额度|quota|rate limit/i.test(text)) return "模型额度不足或请求过于频繁，请稍后重试。";
    if (/502|503|504|网关|bad gateway|service unavailable/i.test(text)) return "模型服务暂时不可用，当前内容已经保留。";
    if (/timeout|timed out|超时/i.test(text)) return "本次请求等待时间过长，当前内容已经保留。";
    if (/content-type|application\/json|expected request/i.test(text)) return "当前模型接口格式与配置不一致，请检查模型配置。";
    if (/failed to fetch|network|请求失败/i.test(text)) return "暂时无法连接模型接口，请检查网络或本地代理。";
    return phase === "analysis" ? "本次商品分析没有完成，素材和需求已经保留。" : "本次图片生成没有完成，方案和提示词已经保留。";
}

function MediaThumb({ src, title, role, showRole, referenced, theme, onRoleChange, onRemove }: { src: string; title: string; role: MediaRole; showRole: boolean; referenced?: boolean; theme: Theme; onRoleChange: (role: MediaRole) => void; onRemove: () => void }) {
    return <div className="w-24 shrink-0" title={title}><div className="group relative mx-auto size-16 overflow-hidden rounded-xl border" style={{ borderColor: role === "reference" ? "#d946ef" : theme.node.stroke }}><img src={src} alt={title} className="size-full object-cover" />{referenced ? <span className="absolute bottom-1 left-1 rounded bg-fuchsia-500 px-1 text-[10px] font-semibold text-white">@</span> : null}<button type="button" className="absolute right-1 top-1 grid size-5 place-items-center rounded-full opacity-0 shadow-sm transition group-hover:opacity-100" style={{ background: theme.toolbar.panel }} onClick={onRemove} aria-label={`移除 ${title}`}><X className="size-3" /></button></div>{showRole ? <button type="button" className="mt-1 w-full truncate text-[10px] text-fuchsia-500" onClick={() => onRoleChange(role === "product" ? "reference" : "product")}>{role === "product" ? "我的商品" : "竞品参考"}</button> : null}</div>;
}
function CreationTypePopover({ value, theme, onChange }: { value: CreationType; theme: Theme; onChange: (value: CreationType) => void }) {
    const itemClass = "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-black/5 dark:hover:bg-white/10";
    const items: Array<{ id: CreationType; title: string; description: string; icon: ReactNode }> = [{ id: "agent", title: "Agent 模式", description: "自主规划任务 · 含上下文", icon: <Bot className="size-5" /> }, { id: "image", title: "图片生成", description: "单次图片生成 · 无上下文", icon: <ImagePlus className="size-5" /> }, { id: "video", title: "视频生成", description: "单次视频生成 · 无上下文", icon: <Video className="size-5" /> }];
    const activeIcon = value === "image" ? <ImagePlus className="size-5" /> : value === "video" ? <Video className="size-5" /> : <Bot className="size-5" />;
    const content = <div className="w-72 p-2"><div className="px-3 pb-2 text-xs font-medium" style={{ color: theme.node.muted }}>创作类型</div>{items.map((item) => <button key={item.id} type="button" className={itemClass} style={{ background: value === item.id ? theme.toolbar.activeBg : "transparent" }} onClick={() => onChange(item.id)}><span className="shrink-0">{item.icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.title}</span><span className="block text-[11px]" style={{ color: theme.node.muted }}>{item.description}</span></span>{value === item.id ? <Check className="size-4 shrink-0" /> : null}</button>)}</div>;
    return <Popover trigger="click" placement="topLeft" content={content}><Tooltip title="创作类型"><Button type="text" shape="circle" icon={<span className="flex items-center gap-1">{activeIcon}<ChevronUp className="size-3.5" /></span>} /></Tooltip></Popover>;
}
function DirectVideoMediaBar({ capabilities, imageCount, videos, audios, theme, onImage, onVideo, onAudio, onAsset, onRemove }: { capabilities?: VideoModelCapabilities; imageCount: number; videos: DirectMedia[]; audios: DirectMedia[]; theme: Theme; onImage: () => void; onVideo: () => void; onAudio: () => void; onAsset: (kind: "image" | "video") => void; onRemove: (id: string) => void }) {
    const slots = [{ kind: "video" as const, label: "视频", count: videos.length, limit: 10, icon: <Video className="size-5" />, onClick: onVideo }, { kind: "image" as const, label: "图片", count: imageCount, limit: MAX_COMPOSER_IMAGES, icon: <ImagePlus className="size-5" />, onClick: onImage }, { kind: "audio" as const, label: "音频", count: audios.length, limit: 10, icon: <Zap className="size-5" />, onClick: onAudio }].filter((slot) => !capabilities || capabilities.inputs.includes(slot.kind));
    return <div className="mb-2"><div className="mb-2 flex items-center justify-between rounded-xl px-2 py-1.5 text-[11px]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}><span>图片、视频可从本地或资产库选择；音频暂用本地上传</span></div><div className="flex gap-2">{slots.map((slot) => { const trigger = <button type="button" className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed text-xs transition hover:bg-black/5 dark:hover:bg-white/10" style={{ borderColor: theme.node.stroke }} onClick={slot.kind === "audio" ? slot.onClick : undefined}><span style={{ color: theme.node.muted }}>{slot.count}/{slot.limit}</span>{slot.icon}<span>{slot.label}</span></button>; if (slot.kind === "audio") return <span key={slot.kind}>{trigger}</span>; const actions = <div className="w-44 space-y-1 p-1"><Button type="text" block className="!h-10 !justify-start !px-3 !text-left !text-sm" icon={<Paperclip className="size-5" />} onClick={slot.onClick}>从本地上传</Button><Button type="text" block className="!h-10 !justify-start !px-3 !text-left !text-sm" icon={<BookOpen className="size-5" />} onClick={() => onAsset(slot.kind)}>从资产库选择</Button></div>; return <Popover key={slot.kind} trigger="click" placement="topLeft" content={actions}>{trigger}</Popover>; })}</div>{videos.length || audios.length ? <div className="mt-2 flex flex-wrap gap-1">{[...videos, ...audios].map((item) => <button key={item.id} type="button" className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px]" style={{ background: theme.toolbar.activeBg }} title="点击移除" onClick={() => onRemove(item.id)}><span className="max-w-28 truncate">{item.name}</span><X className="size-3" /></button>)}</div> : null}</div>;
}
function VideoComposerControls({ capabilities, config, theme, onChange, onOpenModels }: { capabilities?: VideoModelCapabilities; config: AiConfig; theme: Theme; onChange: (key: keyof AiConfig, value: string) => void; onOpenModels: () => void }) {
    const buttonClass = "!size-11 !rounded-full !p-0";
    const ratio = inferVideoRatio(config.size || "auto");
    const resolution = parseVideoResolution(config.vquality);
    const setRatio = (next: string) => onChange("size", computeVideoSize(resolution, next));
    const chooseModel = (value: string) => { onChange("videoModel", value); const next = videoModelCapabilities(config, value); if (!next) return; if (!next.modes.includes(config.videoMode as "reference" | "frames" | "edit")) onChange("videoMode", next.modes[0] || "frames"); const nextResolution = next.resolutions.includes(resolution) ? resolution : next.resolutions[0]; const nextRatio = next.ratios.includes(ratio) ? ratio : next.ratios[0]; if (nextResolution) onChange("vquality", nextResolution); if (nextResolution && nextRatio) onChange("size", computeVideoSize(nextResolution, nextRatio)); onChange("videoSeconds", String(Math.max(next.minSeconds, Math.min(next.maxSeconds, Number(config.videoSeconds) || next.minSeconds)))); if (!next.generateAudio) onChange("videoGenerateAudio", "false"); };
    const modelContent = <div className="w-80 p-2"><div className="mb-2 text-sm font-medium">模型选择</div><ModelPicker config={config} capability="video" value={config.videoModel} fullWidth className="!h-11" onChange={chooseModel} onMissingConfig={onOpenModels} /><div className="mt-2 text-xs" style={{ color: theme.node.muted }}>{capabilities ? "已按模型能力限制可用选项" : "能力未配置，使用通用选项"}</div></div>;
    const referenceOptions = [{ value: "reference", title: "全能参考", description: "图片、视频、音频均可作为参考" }, { value: "frames", title: "首尾帧", description: "用起始和结束画面控制转场" }, { value: "edit", title: "视频编辑", description: "基于原视频定向修改画面内容" }];
    const referenceContent = <div className="w-72 p-2"><div className="mb-2 text-sm font-medium">选择参考方式</div>{referenceOptions.filter((item) => !capabilities || capabilities.modes.includes(item.value as "reference" | "frames" | "edit")).map((item) => <button key={item.value} type="button" className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left" style={{ background: config.videoMode === item.value ? theme.toolbar.activeBg : "transparent" }} onClick={() => onChange("videoMode", item.value)}><ListTodo className="size-5 shrink-0" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.title}</span><span className="block text-xs" style={{ color: theme.node.muted }}>{item.description}</span></span>{config.videoMode === item.value ? <Check className="size-4" /> : null}</button>)}</div>;
    const visualContent = <div className="w-80 space-y-4 p-2"><div><div className="mb-2 text-sm font-medium">画面比例</div><div className="grid grid-cols-6 gap-2">{videoRatioOptions.filter((item) => item.value !== "auto" && (!capabilities || capabilities.ratios.includes(item.value))).map((item) => <button key={item.value} type="button" className="rounded-lg border px-1 py-2 text-xs" style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, background: ratio === item.value ? theme.toolbar.activeBg : "transparent" }} onClick={() => setRatio(item.value)}>{item.value}</button>)}</div></div><div><div className="mb-2 text-sm font-medium">分辨率</div><div className="grid grid-cols-3 gap-2">{["480", "720", "1080"].filter((item) => !capabilities || capabilities.resolutions.includes(item)).map((item) => <button key={item} type="button" className="rounded-xl px-3 py-2 text-sm font-medium" style={{ background: resolution === item ? theme.toolbar.activeBg : "transparent" }} onClick={() => { onChange("vquality", item); onChange("size", computeVideoSize(item, ratio)); }}>{item}p</button>)}</div></div><div className="flex items-center justify-between"><span className="text-sm">生成音频</span><Switch size="small" disabled={capabilities ? !capabilities.generateAudio : false} checked={capabilities?.generateAudio === false ? false : config.videoGenerateAudio !== "false"} onChange={(checked) => onChange("videoGenerateAudio", String(checked))} /></div></div>;
    const minimumSeconds = capabilities?.minSeconds ?? 4; const maximumSeconds = capabilities?.maxSeconds ?? 30; const seconds = Math.max(minimumSeconds, Math.min(maximumSeconds, Number(config.videoSeconds) || minimumSeconds));
    const durationContent = <div className="w-72 p-3"><div className="flex items-center justify-between"><span className="text-sm font-medium">选择视频时长</span><span className="rounded-xl px-3 py-2 text-lg font-semibold" style={{ background: theme.toolbar.activeBg }}>{seconds}<small className="ml-1 text-xs">s</small></span></div><Slider className="mt-4" min={minimumSeconds} max={maximumSeconds} value={seconds} marks={{ [minimumSeconds]: String(minimumSeconds), [maximumSeconds]: String(maximumSeconds) }} onChange={(value) => onChange("videoSeconds", String(Array.isArray(value) ? value[0] : value))} /></div>;
    return <><Popover trigger="click" placement="topLeft" content={modelContent}><Tooltip title="模型选择"><Button type="text" className={buttonClass} icon={<Box className="size-5" />} /></Tooltip></Popover><Popover trigger="click" placement="topLeft" content={referenceContent}><Tooltip title="参考方式"><Button type="text" className={buttonClass} icon={<ListTodo className="size-5" />} /></Tooltip></Popover><Popover trigger="click" placement="topLeft" content={visualContent}><Tooltip title="画面比例与分辨率"><Button type="text" className={buttonClass} icon={<Settings2 className="size-5" />} /></Tooltip></Popover><Popover trigger="click" placement="topLeft" content={durationContent}><Tooltip title="视频时长"><Button type="text" className={buttonClass} icon={<History className="size-5" />} /></Tooltip></Popover></>;
}
function ComposerMediaBar({ attachments, references, theme, onUpload, onAsset, onReference, onRemoveAttachment, onRemoveReference }: { attachments: AgentAttachment[]; references: CanvasResourceReference[]; theme: Theme; onUpload: () => void; onAsset: () => void; onReference: (items: CanvasResourceReference[]) => void; onRemoveAttachment: (id: string) => void; onRemoveReference: (id: string) => void }) {
    const count = attachments.length + references.length;
    const actions = <div className="w-44 space-y-1 p-1"><Button type="text" block className="!h-10 !justify-start !px-3 !text-left !text-sm" icon={<Paperclip className="size-5" />} onClick={onUpload}>从本地上传</Button><CanvasReferenceButton references={references} onChange={onReference} theme={theme} compact label="从画布选择" block /><Button type="text" block className="!h-10 !justify-start !px-3 !text-left !text-sm" icon={<BookOpen className="size-5" />} onClick={onAsset}>从资产库选择</Button></div>;
    return <div className="mb-3 flex gap-2 overflow-x-auto pb-1"><Popover trigger="click" placement="topLeft" content={actions}><button type="button" className="flex size-20 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed text-sm transition hover:bg-black/5 dark:hover:bg-white/10" style={{ borderColor: theme.node.stroke }}><span className="mb-0.5 text-xs" style={{ color: theme.node.muted }}>{count}/{MAX_COMPOSER_IMAGES}</span><ImagePlus className="size-5" /><span className="mt-0.5">上传</span></button></Popover>{attachments.map((item) => <MediaThumb key={item.id} src={item.url} title={item.name} role="product" showRole={false} theme={theme} onRoleChange={() => undefined} onRemove={() => onRemoveAttachment(item.id)} />)}{references.map((item) => <MediaThumb key={item.nodeId} src={item.previewUrl || ""} title={`@ ${item.title}`} role="product" showRole={false} referenced theme={theme} onRoleChange={() => undefined} onRemove={() => onRemoveReference(item.nodeId)} />)}</div>;
}
function CompetitorMediaBar({ attachments, references, mediaRoles, theme, onUpload, onAsset, onReference, onRoleChange, onRemoveAttachment, onRemoveReference }: { attachments: AgentAttachment[]; references: CanvasResourceReference[]; mediaRoles: Record<string, MediaRole>; theme: Theme; onUpload: (role: MediaRole) => void; onAsset: (role: MediaRole) => void; onReference: (references: CanvasResourceReference[], role: MediaRole) => void; onRoleChange: (id: string, role: MediaRole) => void; onRemoveAttachment: (id: string) => void; onRemoveReference: (id: string) => void }) {
    return <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{(["product", "reference"] as const).map((role) => { const items = attachments.filter((item) => (mediaRoles[item.id] || "product") === role); const refs = references.filter((item) => (mediaRoles[item.nodeId] || "product") === role); const label = role === "product" ? "上传商品图片" : "上传参考图片"; const actions = <div className="w-44 space-y-1 p-1"><Button type="text" block className="!h-10 !justify-start !px-3 !text-left !text-sm" icon={<Paperclip className="size-5" />} onClick={() => onUpload(role)}>从本地上传</Button><CanvasReferenceButton references={references} onChange={(next) => onReference(next, role)} theme={theme} compact label="从画布选择" block /><Button type="text" block className="!h-10 !justify-start !px-3 !text-left !text-sm" icon={<BookOpen className="size-5" />} onClick={() => onAsset(role)}>从资产库选择</Button></div>; return <div key={role} className="flex shrink-0 items-start gap-1"><Popover trigger="click" placement="topLeft" content={actions}><button type="button" className="flex h-20 min-w-32 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/10" style={{ borderColor: role === "reference" ? "#d946ef66" : theme.node.stroke }} aria-label={label}><span className="mb-0.5 text-xs" style={{ color: theme.node.muted }}>{items.length + refs.length}/{MAX_COMPOSER_IMAGES}</span><ImagePlus className="size-5" /><span className="mt-0.5">{label}</span></button></Popover>{[...items.map((item) => ({ id: item.id, src: item.url, title: item.name, referenced: false })), ...refs.map((item) => ({ id: item.nodeId, src: item.previewUrl || "", title: item.title, referenced: true }))].map((item) => <MediaThumb key={item.id} src={item.src} title={item.title} role={role} showRole={false} referenced={item.referenced} theme={theme} onRoleChange={(next) => onRoleChange(item.id, next)} onRemove={() => item.referenced ? onRemoveReference(item.id) : onRemoveAttachment(item.id)} />)}</div>; })}</div>;
}

function GenerationSettingsPopover({ ratio, count, disabled, theme, onRatioChange, onCountChange }: { ratio: string; count: number; disabled: boolean; theme: Theme; onRatioChange: (value: string) => void; onCountChange: (value: number) => void }) {
    const content = <div className="w-56 space-y-3"><div><div className="mb-1 text-xs" style={{ color: theme.node.muted }}>画面比例</div><AntSelect className="w-full" size="small" value={ratio} options={imageAspectOptions} onChange={onRatioChange} aria-label="生成比例" /></div><div><div className="mb-1 text-xs" style={{ color: theme.node.muted }}>生成张数</div><AntSelect className="w-full" size="small" value={count} options={Array.from({ length: 15 }, (_, index) => ({ value: index + 1, label: `${index + 1} 张` }))} onChange={onCountChange} aria-label="生成张数" /></div></div>;
    return <Popover trigger="click" placement="top" title="生成设置" content={content}><Button type="text" shape="circle" disabled={disabled} icon={<Settings2 className="size-5" />} aria-label={`生成设置：${ratio}，${count} 张`} /></Popover>;
}
function BuyerModeSelect({ value, disabled, onChange }: { value: BuyerMode; disabled: boolean; onChange: (value: BuyerMode) => void }) {
    return <AntSelect size="small" variant="borderless" value={value} disabled={disabled} popupMatchSelectWidth={170} options={[{ value: "multi-scene", label: "多场景" }, { value: "same-scene", label: "同场景组图" }, { value: "angle-variation", label: "视角裂变" }]} onChange={onChange} aria-label="买家秀创作模式" />;
}
function buyerModeLabel(value: BuyerMode) {
    return value === "same-scene" ? "同场景组图：固定商品、场景、人物与光线，只改变机位、距离和使用状态" : value === "angle-variation" ? "参考图视角裂变：固定参考图中的商品、场景、人物、道具与氛围，只改变拍摄视角、距离和构图" : "多场景买家秀：围绕不同真实使用任务规划多种生活场景";
}

function CompetitorModeSelect({ value, disabled, onChange }: { value: CompetitorMode; disabled: boolean; onChange: (value: CompetitorMode) => void }) {
    return <AntSelect size="small" variant="borderless" value={value} disabled={disabled} popupMatchSelectWidth={180} options={[{ value: "composition", label: "构图结构" }, { value: "scene", label: "使用场景" }, { value: "visual-language", label: "视觉语言" }]} onChange={onChange} aria-label="竞品复刻方向" />;
}

function competitorModeLabel(value: CompetitorMode) {
    return value === "scene" ? "使用场景借鉴：保留合理的使用情境与物体关系，替换竞品专属元素" : value === "visual-language" ? "视觉语言借鉴：提取色彩、材质、光影和镜头节奏，重新组织画面" : "构图结构借鉴：迁移主体占比、视觉重心、层级和留白，并按我的商品重新计算";
}

function formatSkillBrief(skill: CommerceSkill, brief: Record<string, string>) {
    const lines = skill.fields.map((field) => [field.label, brief[field.key]?.trim()] as const).filter((entry) => entry[1]);
    return lines.length ? `用户预填的需求信息（视为用户明确提供的事实）：\n${lines.map(([label, value]) => `${label}：${value}`).join("\n")}\n` : "";
}
function formatSkillPackageRules(skill: CommerceSkill) {
    const info = skill.packageInfo;
    if (!info?.enabledReferences?.length) return "";
    const references = info.references.filter((item) => info.enabledReferences!.includes(item.path));
    return references.length ? `\n\n已启用的技能包参考规则：\n${references.map((item) => `\n【${item.path}】\n${item.content}`).join("\n")}` : "";
}
function videoCapabilityIssue(capabilities: VideoModelCapabilities | undefined, config: AiConfig, imageCount: number, media: DirectMedia[]) {
    if (!capabilities) return "";
    if (!capabilities.modes.includes(config.videoMode as "reference" | "frames" | "edit")) return "当前模型不支持已选择的参考方式，请重新选择";
    if (imageCount && !capabilities.inputs.includes("image")) return "当前模型不支持参考图片，请移除图片或更换模型";
    if (media.some((item) => item.kind === "video") && !capabilities.inputs.includes("video")) return "当前模型不支持参考视频，请移除视频或更换模型";
    if (media.some((item) => item.kind === "audio") && !capabilities.inputs.includes("audio")) return "当前模型不支持参考音频，请移除音频或更换模型";
    const ratio = inferVideoRatio(config.size || "auto");
    if (!capabilities.ratios.includes(ratio)) return `当前模型不支持 ${ratio} 画面比例，请重新选择`;
    const resolution = parseVideoResolution(config.vquality);
    if (!capabilities.resolutions.includes(resolution)) return `当前模型不支持 ${resolution}p 分辨率，请重新选择`;
    const seconds = Number(config.videoSeconds) || capabilities.minSeconds;
    if (seconds < capabilities.minSeconds || seconds > capabilities.maxSeconds) return `当前模型支持 ${capabilities.minSeconds}–${capabilities.maxSeconds} 秒视频，请调整时长`;
    if (config.videoGenerateAudio !== "false" && !capabilities.generateAudio) return "当前模型不支持生成音频，请关闭音频开关";
    return "";
}
function ExecutionModeSelect({ value, disabled, onChange }: { value: ExecutionMode; disabled: boolean; onChange: (value: ExecutionMode) => void }) {
    const options = [
        { value: "automatic", label: <span className="flex items-center gap-2"><Zap className="size-3.5" />自动执行</span> },
        { value: "confirm", label: <span className="flex items-center gap-2"><ShieldCheck className="size-3.5" />确认后执行</span> },
        { value: "plan", label: <span className="flex items-center gap-2"><ListTodo className="size-3.5" />仅规划</span> },
    ];
    return <AntSelect size="small" variant="borderless" value={value} disabled={disabled} popupMatchSelectWidth={140} options={options} onChange={onChange} aria-label="执行模式" />;
}
function PlanCard({ plan, skillId, stage, executionMode, theme, busy, runState, onChange, onStageChange, onExecute, onRegenerate, onReferenceResult }: { plan: CommercePlan; skillId: CommerceSkillId; stage?: WorkflowStage; executionMode: ExecutionMode; theme: Theme; busy: boolean; runState: RunState; onChange: (plan: CommercePlan) => void; onStageChange?: (stage: WorkflowStage) => void; onExecute: () => void; onRegenerate: (itemIds: string | string[]) => void; onReferenceResult: (item: PlanItem, node: CanvasNodeData) => void }) {
    const selectedCount = plan.items.filter((item) => item.selected).length;
    const outlineStage = stage === "structure" || stage === "scenes" || stage === "migration";
    const failedIds = plan.items.filter((item) => item.status === "error").map((item) => item.id);
    const analysis = plan.productAnalysis;
    const canvasNodes = useAgentStore((state) => state.canvasContext?.snapshot.nodes || []);
    const [editingAnalysis, setEditingAnalysis] = useState(false);
    const [openPromptIds, setOpenPromptIds] = useState<Set<string>>(new Set());
    const [preview, setPreview] = useState<{ src: string; title: string } | null>(null);
    const outputNodes = useMemo(() => new Map(canvasNodes.map((node) => [node.id, node])), [canvasNodes]);
    const visibleStrategySections = (plan.strategySections || []).filter((section) => skillId !== "competitor" || stage !== "migration" || /可复用|替换映射|主动差异/.test(section.label));
    const focusOutput = (nodeId: string) => useAgentStore.getState().canvasContext?.focusNode(nodeId);
    const reorderItem = (index: number, offset: -1 | 1) => {
        const target = index + offset;
        if (target < 0 || target >= plan.items.length) return;
        const items = [...plan.items];
        [items[index], items[target]] = [items[target], items[index]];
        onChange({ ...plan, items });
        const canvasContext = useAgentStore.getState().canvasContext;
        const group = plan.resultGroupId ? canvasContext?.snapshot.nodes.find((node) => node.id === plan.resultGroupId) : undefined;
        if (!canvasContext || !group) return;
        const resultItems = items.filter((item) => item.outputNodeId && canvasContext.snapshot.nodes.some((entry) => entry.id === item.outputNodeId));
        const layout = resultBoardLayout(resultItems, skillId);
        const ops = resultItems.flatMap((item, resultIndex) => {
            const node = item.outputNodeId ? canvasContext.snapshot.nodes.find((entry) => entry.id === item.outputNodeId) : undefined;
            if (!node) return [];
            const planIndex = items.findIndex((entry) => entry.id === item.id);
            const cell = resultCellPosition(resultIndex, resultItems.length, group.position, layout);
            return [{ type: "update_node" as const, id: node.id, patch: { title: resultItemTitle(skillId, planIndex, item.title), position: centerResultInCell(cell, layout, node) } }];
        });
        canvasContext.applyOps([{ type: "update_node", id: group.id, patch: { width: layout.width, height: layout.height } }, ...ops]);
    };
    const updateAnalysisList = (key: keyof ProductAnalysis, value: string) => onChange({ ...plan, productAnalysis: { ...analysis, [key]: value.split("\n").map((item) => item.trim()).filter(Boolean) } });
    if (["hero", "detail", "buyer", "competitor"].includes(skillId)) {
        const analysisSectionLabel = (label: string) => skillId === "detail" ? detailAnalysisLabel(label) : skillId === "buyer" ? buyerAnalysisLabel(label) : skillId === "competitor" ? competitorAnalysisLabel(label) : label;
        const analysisRows = [
            ["商品身份", analysis.category || "待确认商品"],
            ["图片识别", analysis.visibleFacts.join("；") || "已识别商品主体"],
            ["已确认信息", analysis.verifiedFacts.join("；") || "以用户素材与需求为准"],
            ["商品保持不变", analysis.identityLock.join("；") || "保持参考商品外观与关键结构"],
            ["未知与禁用", analysis.unknownFacts.join("；") || "暂无"],
        ];
        const analysisStepLabels = [...analysisRows.map(([label]) => label), ...visibleStrategySections.map((section) => analysisSectionLabel(section.label))];
        return <div className="space-y-3">
            <section className="overflow-hidden rounded-[22px] border p-3 backdrop-blur-xl" style={{ background: `color-mix(in srgb, ${theme.toolbar.panel} 78%, transparent)`, borderColor: theme.node.stroke }}>
                <div className="flex items-center justify-between gap-3 px-1 py-1.5"><div className="flex items-center gap-2.5 text-base font-semibold"><span className="grid size-8 place-items-center rounded-xl bg-fuchsia-500/15"><Bot className="size-4 text-fuchsia-500" /></span>智能助手</div><Button type="text" icon={<Pencil className="size-4" />} disabled={busy} onClick={() => setEditingAnalysis((value) => !value)}>{editingAnalysis ? "完成" : "修改"}</Button></div>
                <div className="mt-2 rounded-2xl bg-gradient-to-br from-violet-600/90 to-blue-600/85 px-4 py-3.5 text-[15px] font-medium leading-7 text-white shadow-sm">{plan.summary}</div>
                {editingAnalysis ? <div className="mt-3 space-y-3 rounded-2xl border p-4" style={{ background: `color-mix(in srgb, ${theme.toolbar.activeBg} 58%, transparent)`, borderColor: theme.node.stroke }}><Input size="large" value={analysis.category} placeholder="商品品类" onChange={(event) => onChange({ ...plan, productAnalysis: { ...analysis, category: event.target.value } })} /><EditableAnalysisList label="图片可见事实" value={analysis.visibleFacts} onChange={(value) => updateAnalysisList("visibleFacts", value)} /><EditableAnalysisList label="已确认信息" value={analysis.verifiedFacts} onChange={(value) => updateAnalysisList("verifiedFacts", value)} /><EditableAnalysisList label="商品保持不变" value={analysis.identityLock} onChange={(value) => updateAnalysisList("identityLock", value)} /><EditableAnalysisList label="未知和禁用信息" value={analysis.unknownFacts} onChange={(value) => updateAnalysisList("unknownFacts", value)} /><Input.TextArea className="!text-[15px] !leading-7" value={plan.strategy} autoSize={{ minRows: 3, maxRows: 7 }} placeholder="整体视觉策略" onChange={(event) => onChange({ ...plan, strategy: event.target.value })} />{visibleStrategySections.map((section) => <div key={section.id}><div className="mb-1.5 text-sm opacity-70">{analysisSectionLabel(section.label)}</div><Input.TextArea className="!text-[15px] !leading-7" value={section.content} autoSize={{ minRows: 4, maxRows: 12 }} onChange={(event) => onChange({ ...plan, strategySections: (plan.strategySections || []).map((entry) => entry.id === section.id ? { ...entry, content: event.target.value } : entry) })} /></div>)}</div> : <div className="mt-3 rounded-2xl border p-3" style={{ background: `color-mix(in srgb, ${theme.toolbar.activeBg} 64%, transparent)`, borderColor: theme.node.stroke }}><div className="flex items-center gap-2 px-1 pb-2.5 text-[15px] font-semibold"><Sparkles className="size-4 text-fuchsia-500" />已完成 {analysisStepLabels.length} 个分析步骤</div><div className="space-y-1">{analysisStepLabels.map((label, index) => <div key={`${index}-${label}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500/15"><Check className="size-3.5 text-emerald-500" /></span>{label}</div>)}</div></div>}
                {stage === "analysis" ? <div className="border-t p-3" style={{ borderColor: theme.node.stroke }}><Button className="w-full" type="primary" icon={<Check className="size-4" />} disabled={busy} onClick={() => onStageChange?.(skillId === "detail" ? "structure" : skillId === "buyer" ? "scenes" : skillId === "competitor" ? "migration" : "plan")}>确认分析，查看{skillId === "detail" ? "页面结构" : skillId === "buyer" ? "场景方案" : skillId === "competitor" ? "迁移方案" : "主图方案"}</Button></div> : null}
            </section>
            {!editingAnalysis && stage !== "results" && skillId !== "hero" && plan.strategy ? <section className="overflow-hidden rounded-[22px] border p-4 backdrop-blur-xl" style={{ background: `color-mix(in srgb, ${theme.toolbar.panel} 76%, transparent)`, borderColor: theme.node.stroke }}><div className="text-base font-semibold">视觉系统</div><div className="mt-3 whitespace-pre-wrap text-[15px] leading-7" style={{ color: theme.node.muted }}>{plan.strategy}</div></section> : null}

            {!editingAnalysis && skillId === "hero" && stage !== "results" ? <HeroSchemeOverview plan={plan} ratio={plan.items[0]?.ratio || "1:1"} theme={theme} /> : null}

            {skillId === "detail" && stage === "structure" ? <section className="space-y-3"><div className="rounded-2xl border p-4" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}><div className="text-base font-semibold">详情页8屏结构方案</div><div className="mt-1 text-sm leading-6" style={{ color: theme.node.muted }}>品类路线：痛点共鸣 → 解决方案 → 结构细节 → 使用场景 → 规格收尾</div></div><div className="thin-scrollbar overflow-x-auto rounded-2xl border" style={{ borderColor: theme.node.stroke }}><table className="min-w-[920px] table-fixed border-collapse text-left text-sm"><thead style={{ background: theme.toolbar.activeBg }}><tr>{[["屏序", 72], ["模块名称", 130], ["转化目标", 150], ["画面内容", 250], ["文案方向", 220], ["使用素材", 150]].map(([label, width]) => <th key={label} className="border-b border-r px-3 py-3.5 font-semibold last:border-r-0" style={{ width, borderColor: theme.node.stroke }}>{label}</th>)}</tr></thead><tbody>{plan.items.map((item, index) => <tr key={item.id} className="align-top"><td className="border-b border-r px-3 py-3 last:border-r-0" style={{ borderColor: theme.node.stroke }}><div className="flex items-center gap-2"><Checkbox checked={item.selected} disabled={busy} onChange={(event) => updatePlanItem(plan, item.id, { selected: event.target.checked }, onChange)} />第{index + 1}屏</div></td><td className="border-b border-r px-3 py-3 font-medium last:border-r-0" style={{ borderColor: theme.node.stroke }}>{item.title}<div className="mt-2 flex"><Button type="text" size="small" icon={<ChevronUp className="size-3.5" />} disabled={busy || index === 0} onClick={() => reorderItem(index, -1)} /><Button type="text" size="small" icon={<ChevronDown className="size-3.5" />} disabled={busy || index === plan.items.length - 1} onClick={() => reorderItem(index, 1)} /></div></td><td className="border-b border-r px-3 py-3 leading-6 last:border-r-0" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item.role}</td><td className="border-b border-r px-3 py-3 leading-6 last:border-r-0" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item.goal}</td><td className="border-b border-r px-3 py-3 leading-6 last:border-r-0" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item.copy || "不使用文字"}</td><td className="border-b px-3 py-3 leading-6" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item.materials || "商品主体与已提供素材"}</td></tr>)}</tbody></table></div><Button className="w-full" type="primary" icon={<Check className="size-4" />} disabled={busy || !selectedCount} onClick={() => onStageChange?.("content")}>确认结构，编辑逐屏内容</Button></section> : null}

            {skillId === "hero" && stage === "plan" ? <HeroPlanTable plan={plan} theme={theme} busy={busy} executionMode={executionMode} onChange={onChange} onExecute={onExecute} /> : null}

            {((stage === "plan" && skillId !== "hero") || stage === "scenes" || stage === "migration" || stage === "content") ? <section className="space-y-3"><div className="rounded-2xl border p-4" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}><div className="flex items-start justify-between gap-3"><div><div className="text-base font-semibold"><span className="mr-2 text-fuchsia-500">●</span>{skillId === "detail" ? "详情页方案" : skillId === "buyer" ? "买家秀方案" : skillId === "competitor" ? "复刻迁移方案" : "主图方案"}</div><div className="mt-1 text-sm leading-6" style={{ color: theme.node.muted }}>{outlineStage ? "先确认每个画面的职责与顺序，再进入内容编辑。" : "选择本次需要生成的图片，每张图片可以单独勾选和修改。"}</div></div><Button type="text" disabled={busy} onClick={() => { const selected = selectedCount !== plan.items.length; onChange({ ...plan, items: plan.items.map((item) => ({ ...item, selected })) }); }}>{selectedCount === plan.items.length ? "取消全选" : "全部选择"}</Button></div><div className="mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-sm" style={{ background: theme.toolbar.activeBg }}><span className="font-medium">选择要生成的图片</span><span className="font-semibold text-fuchsia-500">已选择 {selectedCount}/{plan.items.length} 张</span></div></div>{plan.items.map((item, index) => { const editing = openPromptIds.has(item.id); return <article key={item.id} className="overflow-hidden rounded-2xl border" style={{ background: theme.toolbar.panel, borderColor: item.selected ? "#a855f7" : theme.node.stroke }}><div className="flex items-center gap-3 px-4 py-3"><Checkbox checked={item.selected} disabled={busy} onChange={(event) => updatePlanItem(plan, item.id, { selected: event.target.checked }, onChange)} /><div className="min-w-0 flex-1 text-base font-semibold">{skillId === "detail" ? `第 ${index + 1} 屏` : `${index + 1}.`} {item.title}</div><Tooltip title="上移"><Button type="text" size="small" icon={<ChevronUp className="size-3.5" />} disabled={busy || index === 0} onClick={() => reorderItem(index, -1)} /></Tooltip><Tooltip title="下移"><Button type="text" size="small" icon={<ChevronDown className="size-3.5" />} disabled={busy || index === plan.items.length - 1} onClick={() => reorderItem(index, 1)} /></Tooltip><Button type="text" size="small" icon={<Pencil className="size-3.5" />} disabled={busy} onClick={() => setOpenPromptIds((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}>{editing ? "完成" : "修改"}</Button></div>{editing ? <div className="space-y-2 border-t p-3" style={{ borderColor: theme.node.stroke }}><Input value={item.title} placeholder="画面名称" onChange={(event) => updatePlanItem(plan, item.id, { title: event.target.value }, onChange)} /><Input value={item.role} placeholder="这张图的职责" onChange={(event) => updatePlanItem(plan, item.id, { role: event.target.value }, onChange)} /><Input value={item.goal} placeholder="核心目标" onChange={(event) => updatePlanItem(plan, item.id, { goal: event.target.value }, onChange)} /><div className="grid grid-cols-[1fr_110px] gap-2"><Input value={item.copy} placeholder="辅助文案（可留空）" onChange={(event) => updatePlanItem(plan, item.id, { copy: event.target.value }, onChange)} /><AntSelect value={item.ratio} options={imageAspectOptions} onChange={(value) => updatePlanItem(plan, item.id, { ratio: value }, onChange)} /></div><Input.TextArea value={item.prompt} autoSize={{ minRows: 5, maxRows: 12 }} placeholder="图片生成提示词" onChange={(event) => updatePlanItem(plan, item.id, { prompt: event.target.value }, onChange)} /></div> : <div className="border-t text-sm leading-7" style={{ borderColor: theme.node.stroke }}>{[["图片职责", item.role], ["核心目标", item.goal], ["辅助文案", item.copy || "不使用文字"], ["画面比例", item.ratio]].map(([label, value]) => <div key={label} className="grid grid-cols-[104px_1fr] border-b last:border-b-0" style={{ borderColor: theme.node.stroke }}><div className="px-4 py-3 font-semibold" style={{ background: theme.toolbar.activeBg }}>{label}</div><div className="px-4 py-3" style={{ color: theme.node.muted }}>{value}</div></div>)}{!outlineStage ? <details className="border-t px-3 py-2" style={{ borderColor: theme.node.stroke }}><summary className="cursor-pointer py-1 font-semibold text-fuchsia-500">查看生成提示词</summary><div className="mt-2 whitespace-pre-wrap text-[15px] leading-7" style={{ color: theme.node.muted }}>{item.prompt}</div></details> : null}</div>}</article>; })}{outlineStage ? <Button className="w-full" type="primary" icon={<Check className="size-4" />} disabled={busy} onClick={() => onStageChange?.("content")}>确认方案，编辑内容与提示词</Button> : executionMode === "plan" ? <div className="rounded-xl border px-3 py-2.5 text-center text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>当前为仅规划模式，方案已完成，不会提交图片生成。</div> : <Button className="w-full" type="primary" icon={<Check className="size-4" />} disabled={busy || !selectedCount} onClick={onExecute}>确认生成 {selectedCount} 张</Button>}</section> : null}

            {stage === "results" ? <section className="space-y-3"><div className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.muted }}><span className="flex items-center gap-2">{busy ? <LoaderCircle className="size-4 animate-spin text-fuchsia-500" /> : <Check className="size-4 text-emerald-500" />}{busy ? "正在生成图片" : runState && runState.current < runState.total ? `已停止，完成 ${runState.current}/${runState.total}` : runState?.failed ? `${runState.total - runState.failed} 张成功，${runState.failed} 张失败` : "本轮生成已完成"}</span><span>{runState ? `${runState.current}/${runState.total}` : `${plan.items.filter((item) => item.outputNodeId).length}/${plan.items.length}`}</span></div>{plan.items.map((item, index) => { const output = item.outputNodeId ? outputNodes.get(item.outputNodeId) : undefined; const previewUrl = output?.metadata?.content; if (output && previewUrl) return <CommerceResultCard key={item.id} item={item} index={index} node={output} theme={theme} busy={busy} onChange={(patch) => updatePlanItem(plan, item.id, patch, onChange)} onPreview={(src) => setPreview({ src: src || previewUrl, title: item.title })} onRegenerate={() => onRegenerate(item.id)} onReference={() => onReferenceResult(item, output)} />; return <div key={item.id} className="flex items-center gap-3 rounded-xl border p-3 text-sm" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}><div className="grid size-10 place-items-center rounded-lg" style={{ background: theme.toolbar.activeBg }}>{item.status === "loading" ? <LoaderCircle className="size-4 animate-spin" /> : item.status === "error" ? <span className="text-xs text-red-500">失败</span> : <span className="text-xs">等待</span>}</div><div className="min-w-0 flex-1"><div className="font-medium">{skillId === "detail" ? `第 ${index + 1} 屏` : `${index + 1}.`} {item.title}</div>{item.errorDetails ? <div className="mt-1 line-clamp-2 text-xs text-red-500">{item.errorDetails}</div> : <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>生成结果将显示在这里</div>}</div>{item.status === "error" ? <Button size="small" onClick={() => onRegenerate(item.id)}>重试</Button> : null}</div>; })}{skillId === "buyer" ? <BuyerResultChecklist theme={theme} /> : null}{skillId === "competitor" ? <CompetitorResultChecklist theme={theme} /> : null}<div className="grid gap-2">{failedIds.length ? <Button danger icon={<RotateCcw className="size-4" />} onClick={() => onRegenerate(failedIds)}>只重试失败项 {failedIds.length} 张</Button> : null}<Button icon={<RotateCcw className="size-4" />} disabled={busy || !selectedCount} onClick={onExecute}>重新生成已选 {selectedCount} 张</Button></div></section> : null}
            <Modal title={preview?.title || "生成结果"} open={Boolean(preview)} footer={null} width="min(900px, 92vw)" onCancel={() => setPreview(null)}>{preview ? <img src={preview.src} alt={preview.title} className="mx-auto max-h-[75vh] max-w-full rounded-xl object-contain" /> : null}</Modal>
        </div>;
    }
    return <div className="rounded-2xl border p-3" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><Input variant="borderless" className="-ml-3 font-medium" value={plan.title} disabled={busy} onChange={(event) => onChange({ ...plan, title: event.target.value })} />{stage !== "results" ? <><Input.TextArea variant="borderless" className="-ml-3 mt-1 text-xs" autoSize value={plan.summary} disabled={busy} placeholder="商品与目标判断" onChange={(event) => onChange({ ...plan, summary: event.target.value })} /><Input.TextArea variant="borderless" className="-ml-3 mt-1 text-xs" autoSize value={plan.strategy} disabled={busy} placeholder="整体视觉策略" onChange={(event) => onChange({ ...plan, strategy: event.target.value })} /></> : <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>查看生成状态、修改单张提示词或重新生成指定图片</div>}</div><div className="shrink-0 text-right"><div className="text-xs" style={{ color: theme.node.muted }}>{selectedCount}/{plan.items.length}</div><Button type="text" size="small" disabled={busy || !plan.items.length} onClick={() => { const selected = selectedCount !== plan.items.length; onChange({ ...plan, items: plan.items.map((item) => ({ ...item, selected })) }); }}>{selectedCount === plan.items.length ? "取消全选" : "全选"}</Button></div></div>
        {(!stage || stage === "analysis") ? <div className="mt-3 rounded-xl border p-3 text-xs leading-5" style={{ borderColor: theme.node.stroke }}>
            <div className="flex items-center justify-between"><div className="font-medium">商品分析 · {analysis.category}</div><button type="button" disabled={busy} className="flex items-center gap-1 opacity-60 hover:opacity-100" onClick={() => setEditingAnalysis((value) => !value)}><Pencil className="size-3" />{editingAnalysis ? "完成" : "修改"}</button></div>
            {editingAnalysis ? <div className="mt-2 space-y-2"><Input size="small" value={analysis.category} placeholder="商品品类" onChange={(event) => onChange({ ...plan, productAnalysis: { ...analysis, category: event.target.value } })} /><EditableAnalysisList label="图片可见事实" value={analysis.visibleFacts} onChange={(value) => updateAnalysisList("visibleFacts", value)} /><EditableAnalysisList label="已确认信息" value={analysis.verifiedFacts} onChange={(value) => updateAnalysisList("verifiedFacts", value)} /><EditableAnalysisList label="身份锁定" value={analysis.identityLock} onChange={(value) => updateAnalysisList("identityLock", value)} /><EditableAnalysisList label="未知和禁用信息" value={analysis.unknownFacts} onChange={(value) => updateAnalysisList("unknownFacts", value)} /></div> : <div className="mt-2 space-y-2"><div><span style={{ color: theme.node.muted }}>识别结果：</span>{analysis.visibleFacts.slice(0, 2).join("；") || "已识别商品主体"}</div>{analysis.verifiedFacts.length ? <div><span style={{ color: theme.node.muted }}>已确认：</span>{analysis.verifiedFacts.slice(0, 2).join("；")}</div> : null}<div><span style={{ color: theme.node.muted }}>推荐方向：</span>{plan.strategy || plan.summary}</div>{analysis.unknownFacts.length ? <div className="text-amber-500">还有 {analysis.unknownFacts.length} 项信息未确认，生成时不会擅自使用</div> : null}<details className="rounded-lg border px-2 py-1.5" style={{ borderColor: theme.node.stroke }}><summary className="cursor-pointer font-medium">查看完整分析</summary><div className="mt-2 space-y-2">{analysis.visibleFacts.length ? <div><span style={{ color: theme.node.muted }}>图片识别：</span>{analysis.visibleFacts.join("；")}</div> : null}{analysis.verifiedFacts.length ? <div><span style={{ color: theme.node.muted }}>已确认：</span>{analysis.verifiedFacts.join("；")}</div> : null}{analysis.identityLock.length ? <div><span style={{ color: theme.node.muted }}>商品保持不变：</span>{analysis.identityLock.join("；")}</div> : null}{analysis.unknownFacts.length ? <div className="text-amber-500"><span>未知和禁用：</span>{analysis.unknownFacts.join("；")}</div> : null}</div></details></div>}
        </div> : null}
        {(!stage || stage === "plan" || stage === "structure" || stage === "scenes" || stage === "migration" || (skillId === "detail" && stage === "analysis") || (skillId === "buyer" && stage === "analysis") || (skillId === "competitor" && stage === "analysis")) && visibleStrategySections.length ? <div className="mt-3 space-y-2">{visibleStrategySections.map((section) => <details key={section.id} className="rounded-xl border px-3 py-2" style={{ borderColor: theme.node.stroke }}><summary className="cursor-pointer text-xs font-medium">{skillId === "detail" && stage === "analysis" ? detailAnalysisLabel(section.label) : skillId === "buyer" && stage === "analysis" ? buyerAnalysisLabel(section.label) : skillId === "competitor" && stage === "analysis" ? competitorAnalysisLabel(section.label) : section.label}</summary><Input.TextArea className="mt-2" value={section.content} disabled={busy} autoSize={{ minRows: 3, maxRows: 10 }} onChange={(event) => onChange({ ...plan, strategySections: (plan.strategySections || []).map((entry) => entry.id === section.id ? { ...entry, content: event.target.value } : entry) })} /></details>)}</div> : null}
        {stage !== "analysis" ? <div className="mt-3 space-y-2">{plan.items.map((item, index) => { const open = openPromptIds.has(item.id); const output = item.outputNodeId ? outputNodes.get(item.outputNodeId) : undefined; const previewUrl = output?.metadata?.content; if (stage === "results" && output && previewUrl) return <CommerceResultCard key={item.id} item={item} index={index} node={output} theme={theme} busy={busy} onChange={(patch) => updatePlanItem(plan, item.id, patch, onChange)} onPreview={(src) => setPreview({ src: src || previewUrl, title: item.title })} onRegenerate={() => onRegenerate(item.id)} onReference={() => onReferenceResult(item, output)} />; return <div key={item.id} className="rounded-xl px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5"><div className="flex items-start gap-2"><Checkbox checked={item.selected} disabled={busy} onChange={(event) => onChange({ ...plan, items: plan.items.map((entry) => entry.id === item.id ? { ...entry, selected: event.target.checked } : entry) })} />{previewUrl ? <button type="button" className="relative size-14 shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }} onClick={() => setPreview({ src: previewUrl, title: item.title })}><img src={previewUrl} alt={item.title} className="size-full object-cover" />{item.status === "loading" ? <span className="absolute inset-0 grid place-items-center bg-black/40"><LoaderCircle className="size-4 animate-spin text-white" /></span> : null}</button> : item.status ? <div className="grid size-14 shrink-0 place-items-center rounded-lg border px-1 text-center text-[10px]" style={{ borderColor: theme.node.stroke, color: item.status === "error" ? "#ef4444" : theme.node.muted }}>{item.status === "loading" ? <LoaderCircle className="size-4 animate-spin" /> : item.status === "error" ? "生成失败" : item.outputNodeId ? "结果已从画布删除" : "等待结果"}</div> : null}<button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenPromptIds((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}><div className="flex items-center gap-2 text-sm font-medium"><span>{skillId === "detail" ? `第 ${index + 1} 屏` : `${index + 1}.`} {item.title}</span>{item.status === "loading" ? <LoaderCircle className="size-3.5 animate-spin" /> : item.status === "success" ? <Check className="size-3.5 text-emerald-500" /> : item.status === "pending" ? <span className="text-amber-500">待重新生成</span> : item.status === "error" ? <span className="text-red-500">失败</span> : null}{!outlineStage ? <ChevronDown className={`ml-auto size-3.5 transition ${open ? "rotate-180" : ""}`} /> : null}</div><div className="mt-0.5 text-xs leading-5" style={{ color: theme.node.muted }}>{item.role} · {item.goal} · {item.ratio}</div>{item.status === "error" && (item.errorDetails || output?.metadata?.errorDetails) ? <div className="mt-1 line-clamp-2 text-[11px] text-red-500">{item.errorDetails || output?.metadata?.errorDetails}</div> : null}</button><div className="flex shrink-0"><Tooltip title="上移"><Button type="text" size="small" icon={<ChevronUp className="size-3.5" />} disabled={busy || index === 0} onClick={() => reorderItem(index, -1)} /></Tooltip><Tooltip title="下移"><Button type="text" size="small" icon={<ChevronDown className="size-3.5" />} disabled={busy || index === plan.items.length - 1} onClick={() => reorderItem(index, 1)} /></Tooltip><Button type="text" size="small" disabled={busy} icon={<Trash2 className="size-3.5" />} onClick={() => onChange({ ...plan, items: plan.items.filter((entry) => entry.id !== item.id) })} aria-label="删除画面" /></div></div>{open && !outlineStage ? <div className="ml-6 mt-2 space-y-2">{output ? <ResultVersions node={output} theme={theme} disabled={busy} onPreview={(src) => setPreview({ src, title: item.title })} /> : null}<Input size="small" value={item.title} disabled={busy} placeholder={skillId === "detail" ? "页面名称" : "画面名称"} onChange={(event) => updatePlanItem(plan, item.id, { title: event.target.value }, onChange)} /><Input size="small" value={item.role} disabled={busy} placeholder={skillId === "detail" ? "这一屏在购买决策中的职责" : "这张图在购买决策中的职责"} onChange={(event) => updatePlanItem(plan, item.id, { role: event.target.value }, onChange)} /><Input size="small" value={item.goal} disabled={busy} placeholder={skillId === "detail" ? "这一屏的唯一信息目标" : "画面目标"} onChange={(event) => updatePlanItem(plan, item.id, { goal: event.target.value }, onChange)} /><div className="grid grid-cols-[1fr_110px] gap-2"><Input size="small" value={item.copy} disabled={busy} placeholder={skillId === "buyer" ? "配套内容草稿（不会写入图片）" : skillId === "detail" ? "本屏标题或辅助文案（可留空）" : "画面文案（可留空）"} onChange={(event) => updatePlanItem(plan, item.id, { copy: event.target.value }, onChange)} /><AntSelect size="small" value={item.ratio} disabled={busy} options={imageAspectOptions} onChange={(value) => updatePlanItem(plan, item.id, { ratio: value }, onChange)} /></div><Input.TextArea value={item.prompt} disabled={busy} autoSize={{ minRows: 5, maxRows: 12 }} placeholder={skillId === "detail" ? "本屏图片生成提示词" : "图片生成提示词"} onChange={(event) => updatePlanItem(plan, item.id, { prompt: event.target.value }, onChange)} /><div className="flex flex-wrap items-center justify-between gap-1"><span className="text-[11px]" style={{ color: theme.node.muted }}>{item.checks.length ? `检查：${item.checks.join("；")}` : skillId === "detail" ? "修改后可只重做这一屏" : "修改后可只重做这一张"}</span><div className="flex flex-wrap justify-end">{output ? <><Button type="text" size="small" icon={<LocateFixed className="size-3.5" />} disabled={busy} onClick={() => focusOutput(output.id)}>在画布中查看</Button>{previewUrl ? <Button type="text" size="small" icon={<Eye className="size-3.5" />} onClick={() => setPreview({ src: previewUrl, title: item.title })}>放大</Button> : null}</> : null}{item.outputNodeId || item.status === "error" ? <Button type="text" size="small" icon={<RotateCcw className="size-3.5" />} disabled={busy || !item.prompt.trim()} onClick={() => onRegenerate(item.id)}>重新生成{skillId === "detail" ? "此屏" : "此图"}</Button> : null}</div></div></div> : item.copy ? <div className="ml-6 mt-1 truncate text-xs">{skillId === "buyer" ? "内容草稿" : skillId === "detail" ? "本屏文案" : "文案"}：{item.copy}</div> : null}</div>; })}</div> : null}
        {skillId === "buyer" && stage === "results" ? <BuyerResultChecklist theme={theme} /> : null}
        {skillId === "competitor" && stage === "results" ? <CompetitorResultChecklist theme={theme} /> : null}
        {stage === "analysis" ? <Button className="mt-3 w-full" type="primary" icon={<Check className="size-4" />} disabled={busy} onClick={() => onStageChange?.(skillId === "detail" ? "structure" : skillId === "buyer" ? "scenes" : skillId === "competitor" ? "migration" : "plan")}>确认分析并查看{skillId === "detail" ? "页面结构" : skillId === "buyer" ? "场景方案" : skillId === "competitor" ? "迁移方案" : "主图方案"}</Button> : stage === "structure" ? <Button className="mt-3 w-full" type="primary" icon={<Check className="size-4" />} disabled={busy} onClick={() => onStageChange?.("content")}>确认结构并编辑逐屏内容</Button> : stage === "scenes" ? <Button className="mt-3 w-full" type="primary" icon={<Check className="size-4" />} disabled={busy} onClick={() => onStageChange?.("content")}>确认场景并编辑内容与提示词</Button> : stage === "migration" ? <Button className="mt-3 w-full" type="primary" icon={<Check className="size-4" />} disabled={busy} onClick={() => onStageChange?.("content")}>确认迁移方案并编辑提示词</Button> : runState ? <div className="mt-3"><div className="flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5 text-emerald-500" />}已提交 {runState.current}/{runState.total} 个画面</div>{!busy && executionMode !== "plan" ? <div className="mt-2 grid gap-2">{failedIds.length ? <Button danger icon={<RotateCcw className="size-4" />} onClick={() => onRegenerate(failedIds)}>只重试失败项 {failedIds.length} 张</Button> : null}<Button className="w-full" icon={<RotateCcw className="size-4" />} disabled={!selectedCount} onClick={onExecute}>重新生成已选 {selectedCount} 张</Button></div> : null}</div> : executionMode === "plan" ? <div className="mt-3 text-center text-xs" style={{ color: theme.node.muted }}>仅规划模式不会提交图片生成</div> : executionMode === "automatic" && busy ? <div className="mt-3 text-center text-xs" style={{ color: theme.node.muted }}>方案完成后将自动生成</div> : <Button className="mt-3 w-full" type="primary" icon={<Check className="size-4" />} disabled={busy || !selectedCount} onClick={onExecute}>确认生成 {selectedCount} 张</Button>}
        <Modal title={preview?.title || "生成结果"} open={Boolean(preview)} footer={null} width="min(900px, 92vw)" onCancel={() => setPreview(null)}>{preview ? <img src={preview.src} alt={preview.title} className="mx-auto max-h-[75vh] max-w-full rounded-xl object-contain" /> : null}</Modal>
    </div>;
}

function CommerceResultCard({ item, index, node, theme, busy, onChange, onPreview, onRegenerate, onReference }: { item: PlanItem; index: number; node: CanvasNodeData; theme: Theme; busy: boolean; onChange: (patch: Partial<PlanItem>) => void; onPreview: (src?: string) => void; onRegenerate: () => void; onReference: () => void }) {
    const { message } = App.useApp();
    const [editing, setEditing] = useState(false);
    const [annotating, setAnnotating] = useState(false);
    const src = node.metadata?.content || "";
    const model = node.metadata?.model || "图片模型";
    const copyPrompt = async () => { await navigator.clipboard.writeText(item.prompt); message.success("提示词已复制"); };
    return <div className="overflow-hidden rounded-2xl border" style={{ borderColor: theme.node.stroke }}><div className="flex items-center justify-between px-3 py-2"><div><div className="text-sm font-medium"><span className="mr-1 text-fuchsia-500">●</span>{index + 1}. {item.title}</div><div className="mt-0.5 text-[11px]" style={{ color: theme.node.muted }}>{item.role} · {item.ratio}</div></div><Checkbox checked={item.selected} disabled={busy} onChange={(event) => onChange({ selected: event.target.checked })} /></div><button type="button" className="block w-full overflow-hidden" onClick={() => onPreview()}><img src={src} alt={item.title} className="max-h-[420px] w-full object-contain" style={{ background: theme.canvas.background }} /></button><div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]" style={{ color: theme.node.muted }}><span className="truncate">{model} · {item.ratio}</span><span>{item.status === "success" ? "生成完成" : item.status}</span></div><div className="flex flex-wrap gap-1 px-2 pb-2"><Button type="text" size="small" icon={<Square className="size-3.5" />} onClick={() => setAnnotating(true)}>标注图片</Button><Button type="text" size="small" icon={<Link2 className="size-3.5" />} onClick={onReference}>引用图片</Button><Button type="text" size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditing((value) => !value)}>重新编辑</Button><Button type="text" size="small" icon={<RotateCcw className="size-3.5" />} disabled={busy || !item.prompt.trim()} onClick={onRegenerate}>重新生成</Button></div>{editing ? <div className="border-t p-3" style={{ borderColor: theme.node.stroke }}><div className="mb-2 text-xs font-medium">修改这张图片的提示词</div><Input.TextArea value={item.prompt} disabled={busy} autoSize={{ minRows: 5, maxRows: 12 }} onChange={(event) => onChange({ prompt: event.target.value })} /><div className="mt-2 flex justify-end gap-1"><Button type="text" size="small" onClick={() => setEditing(false)}>完成修改</Button><Button type="primary" size="small" disabled={busy || !item.prompt.trim()} onClick={onRegenerate}>按新提示词生成</Button></div></div> : <details className="border-t px-3 py-2" style={{ borderColor: theme.node.stroke }}><summary className="cursor-pointer text-xs font-medium text-fuchsia-500">提示词</summary><div className="mt-2 whitespace-pre-wrap text-xs leading-5" style={{ color: theme.node.muted }}>{item.prompt}</div><Button type="text" size="small" className="mt-1" onClick={() => void copyPrompt()}>复制提示词</Button></details>}<div className="px-3 pb-3"><ResultVersions node={node} theme={theme} disabled={busy} onPreview={onPreview} /></div><ImageAnnotationModal src={src} open={annotating} onClose={() => setAnnotating(false)} onApply={(instruction) => { onChange({ prompt: `${item.prompt.trim()}\n\n${instruction}`.trim() }); setEditing(true); }} /></div>;
}

function EditableAnalysisList({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string) => void }) {
    return <div><div className="mb-1.5 text-sm opacity-70">{label}（每行一项）</div><Input.TextArea className="!text-[15px] !leading-7" autoSize={{ minRows: 3, maxRows: 7 }} value={value.join("\n")} onChange={(event) => onChange(event.target.value)} /></div>;
}

function HeroSchemeOverview({ plan, ratio, theme }: { plan: CommercePlan; ratio: string; theme: Theme }) {
    const section = (pattern: RegExp, fallback: string) => plan.strategySections?.find((item) => pattern.test(item.label))?.content || fallback;
    const rows = [
        ["平台", section(/平台|首图规范/, "淘宝、天猫及常规电商平台")],
        ["品类", plan.productAnalysis.category],
        ["数量", `${plan.items.length}张`],
        ["比例", ratio],
        ["商品判断", plan.productAnalysis.visibleFacts.join("；") || "以商品素材为准"],
        ["待确认风险", plan.productAnalysis.unknownFacts.join("；") || "无明显待确认风险"],
        ["安全分支", section(/安全|合规/, "普通品类，使用真实场景与已确认信息")],
        ["商品形态", section(/形态/, plan.productAnalysis.identityLock[0] || "保持参考商品形态")],
        ["视觉路线", plan.summary],
        ["视觉强度", section(/强度/, "标准主图框架")],
        ["视觉组件", section(/组件/, "系列页眉、卖点标签、信息卡与统一圆角投影")],
        ["视觉系统", plan.strategy],
        ["文案锚点", section(/文案锚点|卖点优先级/, plan.productAnalysis.verifiedFacts.join("；") || "仅使用已确认卖点与参数")],
        ["文案去重", section(/文案去重/, "五张图各承担一个信息任务，避免重复标题与卖点")],
    ];
    return <section className="overflow-hidden rounded-2xl border" style={{ borderColor: theme.node.stroke }}><div className="px-4 py-3 text-base font-semibold">主图套图方案</div><div className="grid grid-cols-[104px_1fr] text-sm leading-6">{rows.map(([label, value]) => <div key={label} className="contents"><div className="border-t border-r px-3 py-2.5 font-semibold" style={{ background: theme.toolbar.activeBg, borderColor: theme.node.stroke }}>{label}</div><div className="border-t px-3 py-2.5 whitespace-pre-wrap" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{value}</div></div>)}</div></section>;
}

function HeroPlanTable({ plan, theme, busy, executionMode, onChange, onExecute }: { plan: CommercePlan; theme: Theme; busy: boolean; executionMode: ExecutionMode; onChange: (plan: CommercePlan) => void; onExecute: () => void }) {
    const selectedCount = plan.items.filter((item) => item.selected).length;
    return <section className="space-y-3"><div className="thin-scrollbar overflow-x-auto rounded-2xl border" style={{ borderColor: theme.node.stroke }}><table className="min-w-[980px] table-fixed border-collapse text-left text-sm"><thead style={{ background: theme.toolbar.activeBg }}><tr>{[["图序", 64], ["图片职责", 150], ["页面模板", 130], ["构图与机位", 190], ["组件与主体/文字", 250], ["最终上图文案", 190]].map(([label, width]) => <th key={label} className="border-b border-r px-3 py-3.5 font-semibold last:border-r-0" style={{ width, borderColor: theme.node.stroke }}>{label}</th>)}</tr></thead><tbody>{plan.items.map((item, index) => <tr key={item.id} className="align-top"><td className="border-b border-r px-3 py-3" style={{ borderColor: theme.node.stroke }}><div className="flex items-center gap-2"><Checkbox checked={item.selected} disabled={busy} onChange={(event) => updatePlanItem(plan, item.id, { selected: event.target.checked }, onChange)} />{index + 1}</div></td><td className="border-b border-r px-3 py-3 font-medium leading-6" style={{ borderColor: theme.node.stroke }}>{item.title}<div className="mt-1 text-xs font-normal" style={{ color: theme.node.muted }}>{item.role}</div></td><td className="border-b border-r px-3 py-3 leading-6" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item.template}</td><td className="border-b border-r px-3 py-3 leading-6" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item.composition}</td><td className="border-b border-r px-3 py-3 leading-6" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item.components}</td><td className="border-b px-3 py-3 leading-6" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item.copy || "不使用文字"}</td></tr>)}</tbody></table></div><section className="overflow-hidden rounded-2xl border" style={{ borderColor: theme.node.stroke }}><div className="px-4 py-3 font-semibold">统一约束</div><div className="grid grid-cols-[100px_1fr] text-sm leading-6">{[["视角去重", "五张图使用不同机位、景别与构图，避免连续主体同位置"], ["保留", plan.productAnalysis.identityLock.join("；") || "保持商品颜色、形态、材质、结构、标识与配件一致"], ["禁止", plan.productAnalysis.unknownFacts.join("；") || "禁止编造参数、认证、效果，禁止修改商品图案与结构"]].map(([label, value]) => <div key={label} className="contents"><div className="border-t border-r px-3 py-2.5 font-semibold" style={{ background: theme.toolbar.activeBg, borderColor: theme.node.stroke }}>{label}</div><div className="border-t px-3 py-2.5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{value}</div></div>)}</div></section>{executionMode === "plan" ? <div className="rounded-xl border px-3 py-2.5 text-center text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>方案已完成，当前为仅规划模式。</div> : <Button className="w-full" type="primary" icon={<Check className="size-4" />} disabled={busy || !selectedCount} onClick={onExecute}>确认生成 {selectedCount} 张主图</Button>}</section>;
}

type ImageAnnotationRect = { x: number; y: number; width: number; height: number };

function ImageAnnotationModal({ src, open, onClose, onApply }: { src: string; open: boolean; onClose: () => void; onApply: (instruction: string) => void }) {
    const [rect, setRect] = useState<ImageAnnotationRect | null>(null);
    const [note, setNote] = useState("");
    const startRef = useRef<{ x: number; y: number } | null>(null);
    useEffect(() => { if (open) { setRect(null); setNote(""); } }, [open, src]);
    const point = (event: ReactPointerEvent<HTMLDivElement>) => { const box = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }; };
    const start = (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); const next = point(event); startRef.current = next; setRect({ ...next, width: 0, height: 0 }); };
    const move = (event: ReactPointerEvent<HTMLDivElement>) => { const origin = startRef.current; if (!origin) return; const next = point(event); setRect({ x: Math.min(origin.x, next.x), y: Math.min(origin.y, next.y), width: Math.abs(next.x - origin.x), height: Math.abs(next.y - origin.y) }); };
    const end = () => { startRef.current = null; };
    const apply = () => {
        if (!rect || rect.width < 0.02 || rect.height < 0.02 || !note.trim()) return;
        const left = Math.round(rect.x * 100); const top = Math.round(rect.y * 100); const right = Math.round((rect.x + rect.width) * 100); const bottom = Math.round((rect.y + rect.height) * 100);
        onApply(`局部标注修改：处理图片左侧 ${left}%–${right}%、顶部 ${top}%–${bottom}% 的区域。${note.trim()}。只修改标注区域及其必要的自然衔接，其他商品外观、构图、文字和背景保持不变。`);
        onClose();
    };
    return <Modal title="标注图片" open={open} width={900} footer={null} centered destroyOnHidden onCancel={onClose}><div className="space-y-3"><div className="text-xs opacity-60">在图片上拖动框选需要修改的位置，再填写修改要求。</div><div className="max-h-[62vh] overflow-auto rounded-xl bg-black/80 p-3 text-center"><div className="relative mx-auto inline-block max-w-full touch-none cursor-crosshair select-none" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><img src={src} alt="待标注图片" draggable={false} className="block max-h-[56vh] max-w-full" />{rect ? <div className="pointer-events-none absolute border-2 border-fuchsia-500 bg-fuchsia-500/15" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}><span className="absolute -top-6 left-0 rounded bg-fuchsia-500 px-1.5 py-0.5 text-[10px] text-white">修改这里</span></div> : null}</div></div><Input.TextArea value={note} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="例如：移除这里多余的装饰，保持商品主体不变" onChange={(event) => setNote(event.target.value)} /><div className="flex items-center justify-between"><Button type="text" disabled={!rect} onClick={() => setRect(null)}>重新框选</Button><div className="flex gap-2"><Button onClick={onClose}>取消</Button><Button type="primary" disabled={!rect || rect.width < 0.02 || rect.height < 0.02 || !note.trim()} onClick={apply}>加入修改要求</Button></div></div></div></Modal>;
}

function ResultVersions({ node, theme, disabled, onPreview }: { node: CanvasNodeData; theme: Theme; disabled: boolean; onPreview: (src: string) => void }) {
    const versions = (node.metadata?.images || []).filter((image) => image.status === "success" && image.content);
    if (versions.length < 2) return null;
    const primaryId = node.metadata?.primaryImageId || versions[0]?.id;
    const selectVersion = (image: CanvasNodeImage) => {
        const edge = Math.max(node.width, node.height);
        const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
        useAgentStore.getState().canvasContext?.applyOps([{ type: "update_node", id: node.id, patch: { position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 }, ...size }, metadata: { content: image.content, storageKey: image.storageKey, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, bytes: image.bytes, mimeType: image.mimeType, primaryImageId: image.id, status: "success" } }]);
    };
    return <div><div className="mb-1 flex items-center justify-between text-[11px]" style={{ color: theme.node.muted }}><span>结果版本</span><span>{versions.length} 个</span></div><div className="flex gap-2 overflow-x-auto pb-1">{versions.map((image, index) => <div key={image.id} className="shrink-0"><button type="button" disabled={disabled} className="relative size-14 overflow-hidden rounded-lg border-2" style={{ borderColor: image.id === primaryId ? "#d946ef" : theme.node.stroke }} title={`切换到版本 ${index + 1}`} onClick={() => selectVersion(image)}><img src={image.content} alt={`版本 ${index + 1}`} className="size-full object-cover" />{image.id === primaryId ? <span className="absolute bottom-0 inset-x-0 bg-fuchsia-500/90 py-0.5 text-[9px] text-white">当前</span> : null}</button><button type="button" className="mt-0.5 block w-14 truncate text-center text-[9px] opacity-60" onClick={() => onPreview(image.content)}>版本 {index + 1}</button></div>)}</div></div>;
}
function updatePlanItem(plan: CommercePlan, itemId: string, patch: Partial<PlanItem>, onChange: (plan: CommercePlan) => void) {
    onChange({ ...plan, items: plan.items.map((item) => item.id === itemId ? { ...item, ...patch } : item) });
}

function MentionPicker({ open, query, skills, theme, onOpenChange, onSkill, children }: { open: boolean; query: string; skills: CommerceSkill[]; theme: Theme; onOpenChange: (open: boolean) => void; onSkill: (skill: CommerceSkill) => void; children: ReactNode }) {
    const needle = query.trim().toLowerCase();
    const filtered = skills.filter((item) => `${item.title}${item.description}`.toLowerCase().includes(needle));
    const content = <div className="w-72"><div className="mb-1 px-2 text-[11px]" style={{ color: theme.node.muted }}>选择技能</div><div className="space-y-1">{filtered.map((item) => <button key={item.id} type="button" className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10" onClick={() => onSkill(item)}><Sparkles className="mt-0.5 size-4 shrink-0 text-fuchsia-500" /><span><span className="block text-xs font-medium">{item.title}</span><span className="line-clamp-1 text-[10px]" style={{ color: theme.node.muted }}>{item.description}</span></span></button>)}</div>{!filtered.length ? <div className="py-6 text-center text-xs" style={{ color: theme.node.muted }}>没有匹配的技能</div> : null}</div>;
    return <Popover open={open} trigger="click" placement="topLeft" content={content} onOpenChange={(next) => { if (!next) onOpenChange(false); }}>{children}</Popover>;
}
function hasMentionQuery(value: string) { return /@[^@\n]*$/.test(value); }
function mentionQuery(value: string) { return value.match(/@([^@\n]*)$/)?.[1] || ""; }
function removeMentionQuery(value: string) { return value.replace(/@[^@\n]*$/, "").trimEnd(); }

function CanvasReferenceButton({ references, onChange, theme, compact = false, label, block = false }: { references: CanvasResourceReference[]; onChange: (references: CanvasResourceReference[]) => void; theme: Theme; compact?: boolean; label?: string; block?: boolean }) {
    const [open, setOpen] = useState(false);
    const snapshot = useAgentStore((state) => state.canvasContext?.snapshot);
    const candidates = useMemo(() => (snapshot?.nodes || []).filter((node) => node.type === CanvasNodeType.Image && node.metadata?.content).map((node, index) => ({ id: node.id, nodeId: node.id, kind: "image" as const, label: `图片${index + 1}`, title: node.title || `图片${index + 1}`, previewUrl: node.metadata?.content, active: true })), [snapshot?.nodes]);
    return <><Button type="text" size={compact ? "small" : "middle"} block={block} className={block ? "!h-10 !justify-start !px-3 !text-left !text-sm" : undefined} shape={label ? undefined : "circle"} icon={<span className="text-base font-semibold">@</span>} onClick={() => setOpen(true)} aria-label="引用画布图片">{label}</Button>{!compact && references.length ? <span className="text-[11px]" style={{ color: theme.node.muted }}>{references.length} 项</span> : null}<Modal title="引用画布图片" open={open} footer={null} width={600} onCancel={() => setOpen(false)}><div className="mt-3 grid max-h-[55vh] grid-cols-3 gap-3 overflow-y-auto">{candidates.map((item) => { const checked = references.some((entry) => entry.nodeId === item.nodeId); return <button key={item.nodeId} className="relative aspect-square overflow-hidden rounded-xl border" style={{ borderColor: checked ? "#d946ef" : theme.node.stroke }} onClick={() => onChange(checked ? references.filter((entry) => entry.nodeId !== item.nodeId) : [...references, item])}><img src={item.previewUrl} className="size-full object-cover" />{checked ? <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-fuchsia-500 text-white"><Check className="size-4" /></span> : null}</button>; })}</div>{!candidates.length ? <div className="py-12 text-center text-sm" style={{ color: theme.node.muted }}>画布里还没有可以引用的图片</div> : null}</Modal></>;
}

function parsePlanResponse(text: string): PlanResponse {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("模型没有返回可执行的方案，请重试");
    const value = JSON.parse(text.slice(start, end + 1)) as Partial<CommercePlan> & { status?: string; questions?: unknown };
    if (value.status === "needs_input") {
        const questions = stringArray(value.questions).slice(0, 2);
        if (questions.length) return { questions };
    }
    const items = Array.isArray(value.items) ? value.items.filter((item) => item && typeof item.prompt === "string").map((item) => ({ id: nanoid(), title: String(item.title || "生成画面"), role: String(item.role || "辅助购买决策"), goal: String(item.goal || ""), copy: String(item.copy || ""), materials: String(item.materials || "商品主体与已提供素材"), template: String(item.template || "标准页面"), composition: String(item.composition || item.goal || "根据商品规划构图"), components: String(item.components || "商品主体、信息层级与辅助组件"), prompt: String(item.prompt), ratio: String(item.ratio || "auto"), checks: stringArray(item.checks), selected: true })) : [];
    if (!items.length) throw new Error("方案中没有可生成的画面，请补充要求后重试");
    const analysis = value.productAnalysis as Partial<ProductAnalysis> | undefined;
    const strategySections = Array.isArray(value.strategySections) ? value.strategySections.filter((section) => section && typeof section === "object").map((section, index) => { const entry = section as Partial<StrategySection>; return { id: nanoid(), label: String(entry.label || `分析 ${index + 1}`), content: String(entry.content || "") }; }).filter((section) => section.content) : [];
    return { title: String(value.title || "电商视觉方案"), summary: String(value.summary || "已完成商品分析"), strategy: String(value.strategy || ""), productAnalysis: { category: String(analysis?.category || "待确认商品"), visibleFacts: stringArray(analysis?.visibleFacts), verifiedFacts: stringArray(analysis?.verifiedFacts), unknownFacts: stringArray(analysis?.unknownFacts), identityLock: stringArray(analysis?.identityLock) }, strategySections, items };
}
function stringArray(value: unknown) { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }
function inferRequestedCount(text: string, fallback: number) {
    const match = text.match(/(?:生成|设计|做|出|规划)?\s*([1-9]|1[0-5])\s*(?:张|屏|个(?:板块|模块|画面)?)/);
    return match ? Number(match[1]) : fallback;
}
function inferRevisionTargets(text: string, itemCount: number) {
    if (/(全部|所有|整组|每一张|每张)/.test(text)) return Array.from({ length: itemCount }, (_, index) => index);
    const values = [
        ...[...text.matchAll(/(?:第\s*([一二三四五六七八九十]{1,3}|1[0-5]|[1-9])\s*(?:张|幅|个)|([一二三四五六七八九十]{1,3}|1[0-5]|[1-9])\s*号(?:图)?)/g)].map((match) => chineseNumber(match[1] || match[2])),
        ...[...text.matchAll(/(?:图|图片)\s*([一二三四五六七八九十]{1,3}|1[0-5]|[1-9])/g)].map((match) => chineseNumber(match[1])),
    ].filter((value) => value >= 1 && value <= itemCount);
    return [...new Set(values.map((value) => value - 1))];
}
function chineseNumber(value: string) {
    if (/^\d+$/.test(value)) return Number(value);
    const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (value === "十") return 10;
    if (value.startsWith("十")) return 10 + (digits[value[1]] || 0);
    if (value.endsWith("十")) return (digits[value[0]] || 0) * 10;
    return digits[value] || 0;
}
function mergePlanRevision(current: CommercePlan, revised: CommercePlan, revisionTargets: number[]): CommercePlan {
    return {
        ...revised,
        resultGroupId: current.resultGroupId,
        items: revised.items.map((item, index) => {
            const previous = current.items[index];
            return previous ? { ...item, id: previous.id, selected: previous.selected, outputNodeId: previous.outputNodeId, status: revisionTargets.includes(index) ? "pending" : previous.status, errorDetails: revisionTargets.includes(index) ? undefined : previous.errorDetails } : item;
        }),
    };
}
function planForApi(plan: CommercePlan) { const { resultGroupId: _resultGroupId, ...content } = plan; return { ...content, items: plan.items.map(({ id: _id, selected: _selected, outputNodeId: _outputNodeId, status: _status, errorDetails: _errorDetails, ...item }) => item) }; }
function applyPlanPreferences(plan: CommercePlan, count: number, ratio: string): CommercePlan {
    return { ...plan, items: plan.items.slice(0, count).map((item) => ({ ...item, ratio: ratio === "auto" ? item.ratio : ratio })) };
}
function resultBoardLayout(items: PlanItem[], skillId?: CommerceSkillId) {
    const count = items.length;
    const detail = skillId === "detail";
    const columns = detail ? 1 : count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
    const rows = Math.ceil(Math.max(1, count) / columns);
    const padding = 18;
    const gap = 18;
    const headerHeight = 52;
    const bounds = detail ? { width: 420, height: 560 } : { width: 320, height: 300 };
    const plannedSizes = items.map((item) => plannedImageSize(item.ratio, bounds));
    const imageWidth = Math.max(detail ? 320 : 220, ...plannedSizes.map((size) => size.width));
    const imageHeight = Math.max(detail ? 420 : 220, ...plannedSizes.map((size) => size.height));
    const cellWidth = imageWidth;
    const cellHeight = imageHeight;
    return { columns, rows, padding, gap, headerHeight, cellWidth, cellHeight, imageWidth, imageHeight, width: padding * 2 + columns * cellWidth + Math.max(0, columns - 1) * gap, height: headerHeight + padding + rows * cellHeight + Math.max(0, rows - 1) * gap };
}
function plannedImageSize(ratio: string, bounds: { width: number; height: number }) {
    const match = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return { width: Math.min(bounds.width, 280), height: Math.min(bounds.height, 280) };
    const sourceWidth = Number(match[1]);
    const sourceHeight = Number(match[2]);
    if (!sourceWidth || !sourceHeight) return { width: Math.min(bounds.width, 280), height: Math.min(bounds.height, 280) };
    const scale = Math.min(bounds.width / sourceWidth, bounds.height / sourceHeight);
    return { width: Math.round(sourceWidth * scale), height: Math.round(sourceHeight * scale) };
}
function resultCellPosition(index: number, count: number, groupPosition: { x: number; y: number }, layout: ReturnType<typeof resultBoardLayout>) {
    const row = Math.floor(index / layout.columns);
    const column = index % layout.columns;
    const rowStart = row * layout.columns;
    const itemsInRow = Math.min(layout.columns, Math.max(0, count - rowStart));
    const fullRowWidth = layout.columns * layout.cellWidth + Math.max(0, layout.columns - 1) * layout.gap;
    const currentRowWidth = itemsInRow * layout.cellWidth + Math.max(0, itemsInRow - 1) * layout.gap;
    const rowOffset = Math.max(0, (fullRowWidth - currentRowWidth) / 2);
    return { x: groupPosition.x + layout.padding + rowOffset + column * (layout.cellWidth + layout.gap), y: groupPosition.y + layout.headerHeight + row * (layout.cellHeight + layout.gap) };
}
function centerResultInCell(cell: { x: number; y: number }, layout: ReturnType<typeof resultBoardLayout>, size: { width: number; height: number }) {
    return { x: cell.x + (layout.cellWidth - size.width) / 2, y: cell.y + (layout.cellHeight - size.height) / 2 };
}
function resultItemTitle(skillId: CommerceSkillId, index: number, title: string) { return skillId === "detail" ? `第 ${index + 1} 屏 · ${title}` : `${index + 1}. ${title}`; }
function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }

function mergeImageVersions(current: CanvasNodeData, generated: CanvasNodeData): CanvasNodeImage[] {
    const currentImages = current.metadata?.images?.length ? current.metadata.images : nodeAsImageVersion(current);
    const generatedImages = generated.metadata?.images?.length ? generated.metadata.images : nodeAsImageVersion(generated);
    return [...new Map([...currentImages, ...generatedImages].map((image) => [image.id, image])).values()];
}
function nodeAsImageVersion(node: CanvasNodeData): CanvasNodeImage[] {
    if (!node.metadata?.content) return [];
    return [{ id: node.metadata.primaryImageId || node.id, status: "success", content: node.metadata.content, storageKey: node.metadata.storageKey, naturalWidth: node.metadata.naturalWidth || node.width, naturalHeight: node.metadata.naturalHeight || node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "image/png" }];
}

function waitForCanvasGeneration(configId: string, signal: AbortSignal) {
    return new Promise<{ status: "success" | "error"; nodeId?: string }>((resolve, reject) => {
        let unsubscribe: () => void = () => {};
        const finish = (status: "success" | "error", nodeId?: string) => {
            unsubscribe();
            signal.removeEventListener("abort", abort);
            resolve({ status, nodeId });
        };
        const abort = () => {
            unsubscribe();
            reject(new DOMException("已停止", "AbortError"));
        };
        const inspect = () => {
            const snapshot = useAgentStore.getState().canvasContext?.snapshot;
            const resultIds = snapshot?.connections.filter((connection) => connection.fromNodeId === configId).map((connection) => connection.toNodeId) || [];
            const result = snapshot?.nodes.find((node) => resultIds.includes(node.id) && (node.metadata?.status === "success" || node.metadata?.status === "error"));
            if (result?.metadata?.status === "success" || result?.metadata?.status === "error") finish(result.metadata.status, result.id);
        };
        signal.addEventListener("abort", abort, { once: true });
        unsubscribe = useAgentStore.subscribe(inspect);
        inspect();
    });
}


























