import { Button, Checkbox, Drawer, Input, InputNumber, Modal, Segmented, Select, Space, Switch } from "antd";
import { ListPlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ImageEditRequestFormat, type ModelCapability, type ModelChannel, type VideoModelCapabilities, type VideoReferenceInput, type VideoReferenceMode } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [capabilityTarget, setCapabilityTarget] = useState("");
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setImageEditRequestFormat = (name: string, imageEditRequestFormat: ImageEditRequestFormat) => setModels(draft.models.map((model) => (model.name === name ? { ...model, imageEditRequestFormat: imageEditRequestFormat === "multipart" ? undefined : imageEditRequestFormat } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const setVideoCapabilities = (name: string, videoCapabilities?: VideoModelCapabilities) => setModels(draft.models.map((model) => (model.name === name ? { ...model, videoCapabilities } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                </label>
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                {model.capability === "image" ? <Select size="small" className="w-40" value={model.imageEditRequestFormat || "multipart"} options={[{ value: "multipart", label: "参考图：文件表单" }, { value: "json", label: "参考图：JSON" }]} onChange={(value) => setImageEditRequestFormat(model.name, value)} /> : null}
                                {model.capability === "video" ? <Button size="small" type={model.videoCapabilities ? "primary" : "default"} ghost={Boolean(model.videoCapabilities)} onClick={() => setCapabilityTarget(model.name)}>视频能力</Button> : null}
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
            <VideoCapabilitiesModal model={draft.models.find((item) => item.name === capabilityTarget) || null} open={Boolean(capabilityTarget)} onChange={(value) => setVideoCapabilities(capabilityTarget, value)} onClose={() => setCapabilityTarget("")} />
        </Drawer>
    );
}

const defaultVideoCapabilities: VideoModelCapabilities = { modes: ["reference", "frames", "edit"], inputs: ["image", "video", "audio"], ratios: ["1:1", "3:4", "4:3", "16:9", "9:16", "21:9"], resolutions: ["480", "720", "1080"], minSeconds: 4, maxSeconds: 30, generateAudio: true };

function VideoCapabilitiesModal({ model, open, onChange, onClose }: { model: ChannelModel | null; open: boolean; onChange: (value?: VideoModelCapabilities) => void; onClose: () => void }) {
    if (!model) return null;
    const value = model.videoCapabilities || defaultVideoCapabilities;
    const patch = (next: Partial<VideoModelCapabilities>) => onChange({ ...value, ...next });
    return <Modal title={`${model.name} · 视频能力`} open={open} width={620} onCancel={onClose} footer={<div className="flex justify-between"><Button onClick={() => { onChange(undefined); onClose(); }}>恢复通用能力</Button><Button type="primary" onClick={onClose}>完成</Button></div>}><div className="space-y-5 pt-2"><div className="text-xs text-stone-500">配置后，视频输入栏只显示该模型实际支持的选项。恢复通用能力后不做限制。</div><CapabilityChoices title="参考方式" value={value.modes} options={[{ value: "reference", label: "全能参考" }, { value: "frames", label: "首尾帧" }, { value: "edit", label: "视频编辑" }]} onChange={(items) => patch({ modes: items as VideoReferenceMode[] })} /><CapabilityChoices title="参考素材" value={value.inputs} options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }, { value: "audio", label: "音频" }]} onChange={(items) => patch({ inputs: items as VideoReferenceInput[] })} /><CapabilityChoices title="画面比例" value={value.ratios} options={defaultVideoCapabilities.ratios.map((item) => ({ value: item, label: item }))} onChange={(ratios) => patch({ ratios })} /><CapabilityChoices title="分辨率" value={value.resolutions} options={defaultVideoCapabilities.resolutions.map((item) => ({ value: item, label: `${item}p` }))} onChange={(resolutions) => patch({ resolutions })} /><div><div className="mb-2 text-sm font-medium">视频时长</div><div className="flex items-center gap-2"><InputNumber min={1} value={value.minSeconds} addonAfter="秒" onChange={(next) => patch({ minSeconds: Number(next) || 1, maxSeconds: Math.max(Number(next) || 1, value.maxSeconds) })} /><span className="text-stone-500">至</span><InputNumber min={value.minSeconds} value={value.maxSeconds} addonAfter="秒" onChange={(next) => patch({ maxSeconds: Math.max(value.minSeconds, Number(next) || value.minSeconds) })} /></div></div><div className="flex items-center justify-between"><span className="text-sm font-medium">支持生成音频</span><Switch checked={value.generateAudio} onChange={(generateAudio) => patch({ generateAudio })} /></div></div></Modal>;
}

function CapabilityChoices({ title, value, options, onChange }: { title: string; value: string[]; options: Array<{ value: string; label: string }>; onChange: (value: string[]) => void }) {
    return <div><div className="mb-2 text-sm font-medium">{title}</div><Checkbox.Group value={value} options={options} onChange={(items) => onChange(items.map(String))} /></div>;
}
