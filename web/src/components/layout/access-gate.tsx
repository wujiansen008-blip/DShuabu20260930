import { useEffect, useState, type ReactNode } from "react";
import { Button, Input } from "antd";
import { KeyRound, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { GATEWAY_BASE_URL } from "@/constant/env";
import { readAccessCode, saveAccessCode, verifyAccessCode } from "@/lib/access-code";

// 访问码门槛：只有网关声明「需要访问码」时才出现。
// 网关没配码（本地开发）或连不上网关时直接放行，避免把自己锁在门外。
type GateState = "checking" | "locked" | "open";

const copy = {
    "zh-CN": {
        title: "请输入访问码",
        hint: "这串码由管理员分配，用来区分使用者。填一次即可，之后会自动记住。",
        placeholder: "访问码",
        submit: "进入",
        checking: "正在连接…",
        invalid: "访问码无效或已停用，请向管理员确认。",
        network: "无法连接服务器，请检查网络后重试。",
        empty: "请先填写访问码。",
    },
    "en-US": {
        title: "Access code required",
        hint: "Your administrator assigns this code to identify users. You only need to enter it once.",
        placeholder: "Access code",
        submit: "Continue",
        checking: "Connecting…",
        invalid: "This code is invalid or disabled. Please contact your administrator.",
        network: "Cannot reach the server. Check your network and try again.",
        empty: "Enter your access code first.",
    },
} as const;

export function AccessGate({ children }: { children: ReactNode }) {
    const { i18n } = useTranslation();
    const dictionary = copy[i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN"];
    const [state, setState] = useState<GateState>("checking");
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const response = await fetch(`${GATEWAY_BASE_URL}/__health`);
                if (!response.ok) throw new Error("health failed");
                const data = (await response.json()) as { codeRequired?: boolean };
                if (!alive) return;
                if (!data.codeRequired) {
                    setState("open");
                    return;
                }
                const saved = readAccessCode();
                if (saved) {
                    const result = await verifyAccessCode(saved);
                    if (!alive) return;
                    if (result.ok) {
                        setState("open");
                        return;
                    }
                }
                if (alive) setState("locked");
            } catch {
                // 网关不可达：放行，让用户在应用内看到具体报错，而不是卡在门口
                if (alive) setState("open");
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    const submit = async () => {
        const trimmed = code.trim();
        if (!trimmed) {
            setError(dictionary.empty);
            return;
        }
        setSubmitting(true);
        setError("");
        const result = await verifyAccessCode(trimmed);
        setSubmitting(false);
        if (result.ok) {
            saveAccessCode(trimmed);
            setState("open");
            return;
        }
        setError(result.error === "unreachable" ? dictionary.network : dictionary.invalid);
    };

    if (state === "open") return <>{children}</>;

    return (
        <div className="flex min-h-dvh items-center justify-center bg-stone-50 px-6 dark:bg-stone-950">
            <div className="w-full max-w-sm">
                <div className="mb-6 flex items-center gap-2 text-stone-900 dark:text-stone-100">
                    <KeyRound className="size-5" />
                    <h1 className="text-lg font-semibold tracking-tight">{dictionary.title}</h1>
                </div>
                {state === "checking" ? (
                    <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                        <LoaderCircle className="size-4 animate-spin" />
                        {dictionary.checking}
                    </div>
                ) : (
                    <>
                        <p className="mb-4 text-sm leading-6 text-stone-500 dark:text-stone-400">{dictionary.hint}</p>
                        <Input.Password
                            autoFocus
                            size="large"
                            value={code}
                            placeholder={dictionary.placeholder}
                            status={error ? "error" : undefined}
                            onChange={(event) => {
                                setCode(event.target.value);
                                if (error) setError("");
                            }}
                            onPressEnter={() => void submit()}
                        />
                        {error ? <div className="mt-2 text-sm text-red-500">{error}</div> : null}
                        <Button type="primary" size="large" block className="mt-4" loading={submitting} onClick={() => void submit()}>
                            {dictionary.submit}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
