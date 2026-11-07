// 注意：内置技能的 planningGuide 已迁到服务端（server/prompts/commerce-guides.mjs），
// 这里只保留 {{GUIDE:id}} 占位符，由 server/gateway.mjs 在转发前替换。
// 自定义技能不受影响，其 planningGuide 仍是用户自己填写的真实内容。

export type CommerceSkillId = "hero" | "detail" | "buyer" | "competitor" | `custom:${string}`;

export type CommerceSkillPackage = {
    format: "zip";
    fileName: string;
    entryFile: string;
    references: Array<{ path: string; content: string }>;
    enabledReferences?: string[];
    assets: string[];
    scripts: string[];
    fileCount: number;
};

export type CommerceSkill = {
    id: CommerceSkillId;
    title: string;
    description: string;
    defaultRequest: string;
    planningGuide: string;
    fields: Array<{ key: string; label: string; placeholder: string; options?: string[] }>;
    defaultCount?: number;
    defaultRatio?: string;
    materialMode?: "product" | "product-reference";
    packageInfo?: CommerceSkillPackage;
};

export const commerceSkills: CommerceSkill[] = [
    {
        id: "hero",
        title: "商品主图设计",
        description: "提炼卖点，规划并生成适合电商平台的商品主图",
        defaultCount: 5,
        defaultRequest: "请分析这些商品素材，为商品设计一套电商主图方案。",
        planningGuide: "{{GUIDE:hero}}",
        fields: [
            { key: "platform", label: "投放平台", placeholder: "请选择平台", options: ["淘宝 / 天猫", "京东", "拼多多", "Amazon", "小红书", "其他"] },
            { key: "productFacts", label: "商品名称和已确认信息", placeholder: "例如：产品名、型号、尺寸、材质、包装数量和真实参数" },
            { key: "audience", label: "目标人群", placeholder: "例如：25–35 岁职场女性" },
            { key: "sellingPoint", label: "核心卖点", placeholder: "例如：便携、防漏、快速加热" },
        ],
    },
    {
        id: "detail",
        title: "商品详情页设计",
        description: "诊断品类与渠道，规划有证据、可转化、可合规落地的详情页",
        defaultCount: 8,
        defaultRequest: "请根据这些商品素材，默认规划一套8屏电商详情页。",
        planningGuide: "{{GUIDE:detail}}",
        fields: [
            { key: "productFacts", label: "商品或品类", placeholder: "例如：便携榨汁杯、宠物猫砂盆" },
            { key: "platform", label: "页面平台", placeholder: "请选择平台", options: ["淘宝 / 天猫", "京东", "Amazon A+", "小红书", "独立站", "其他"] },
            { key: "audience", label: "目标人群", placeholder: "填写主要购买人群" },
            { key: "sellingPoint", label: "卖点与证据", placeholder: "填写卖点、参数、认证或使用效果" },
            { key: "priceBand", label: "价格带", placeholder: "例如：50–100 元、中高端；不确定可留空" },
        ],
    },
    {
        id: "buyer",
        title: "买家秀设计",
        description: "生成自然可信、有真实生活感的买家秀",
        defaultCount: 3,
        defaultRatio: "3:4",
        defaultRequest: "请根据这些商品素材，设计真实自然的买家秀内容。",
        planningGuide: "{{GUIDE:buyer}}",
        fields: [
            { key: "persona", label: "人物设定", placeholder: "例如：年轻女性、宝妈、户外爱好者" },
            { key: "scene", label: "使用场景", placeholder: "例如：卧室、办公室、露营地" },
            { key: "style", label: "真实感偏好", placeholder: "请选择风格", options: ["自然随手拍", "生活方式分享", "开箱体验", "使用前后对比", "其他"] },
        ],
    },
    {
        id: "competitor",
        title: "竞品复刻",
        description: "拆解参考素材，并替换为自己的商品生成同类视觉",
        defaultRequest: "请拆解参考素材的构图和视觉逻辑，并为我的商品生成同类方案。",
        materialMode: "product-reference",
        planningGuide: "{{GUIDE:competitor}}",
        fields: [
            { key: "platform", label: "使用平台", placeholder: "请选择平台", options: ["淘宝 / 天猫", "京东", "Amazon", "小红书", "其他"] },
            { key: "keep", label: "需要借鉴", placeholder: "例如：构图、场景、光线、信息层级" },
            { key: "avoid", label: "必须避免", placeholder: "例如：竞品品牌、文字、包装和人物面孔" },
        ],
    },
];

export function commerceSkillById(id: CommerceSkillId) {
    return commerceSkills.find((skill) => skill.id === id) || commerceSkills[0];
}
