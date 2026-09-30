import localforage from "localforage";
import type { CommerceSkill } from "@/lib/commerce/commerce-skills";

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "commerce_assistant" });
const skillStore = localforage.createInstance({ name: "infinite-canvas", storeName: "commerce_skills" });

export type CommerceAssistantTask = {
    id: string;
    title: string;
    updatedAt: number;
    skillId: string | null;
    prompt: string;
    messages: Array<{ id: string; role: "user" | "assistant" | "error"; text: string; attachments?: string[]; phase?: "analysis" | "generation"; model?: string; endpoint?: string; retry?: "analysis" | "generation" }>;
    plan: unknown;
    ratio: string;
    count: number;
    executionMode: "automatic" | "confirm" | "plan";
    brief: Record<string, string>;
    attachments: unknown[];
    references: unknown[];
    mediaRoles: Record<string, "product" | "reference">;
    heroStage: "prepare" | "analysis" | "plan" | "results";
    detailStage: "prepare" | "analysis" | "structure" | "content" | "results";
    buyerStage: "prepare" | "analysis" | "scenes" | "content" | "results";
    competitorStage: "prepare" | "analysis" | "migration" | "content" | "results";
};

export type CommerceAssistantWorkspace = {
    version: 4;
    activeTaskId: string;
    tasks: CommerceAssistantTask[];
};

export function loadCommerceAssistant(projectId: string) {
    return store.getItem<CommerceAssistantWorkspace>(projectId);
}

export function saveCommerceAssistant(projectId: string, snapshot: CommerceAssistantWorkspace) {
    return store.setItem(projectId, snapshot);
}

export function loadCommerceCustomSkills() {
    return skillStore.getItem<CommerceSkill[]>("skills");
}

export function saveCommerceCustomSkills(skills: CommerceSkill[]) {
    return skillStore.setItem("skills", skills);
}
