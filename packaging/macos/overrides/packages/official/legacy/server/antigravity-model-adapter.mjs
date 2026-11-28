import { access } from "node:fs/promises";
import { detectKnownAgentRunnerInstallation } from "./antigravity-probe.mjs";
import { resolveRunnerLaunch } from "./agent-runner-launch.mjs";
import { runExternalCliAgent } from "./external-cli-agent-runner.mjs";

export const testAntigravityModelAdapter = async ({ settings = {}, cwd, environment = process.env }, {
  detectRunner = detectKnownAgentRunnerInstallation,
  runAgent = runExternalCliAgent,
} = {}) => {
  const cliPath = String(settings.cliPath || "agy").trim();
  const model = String(settings.agentModelId || settings.model || "").trim();
  if (String(settings.cliArgs || "").trim()) throw Object.assign(new Error("Antigravity 使用内置参数与 stdin 协议，请清空自定义参数模板"), { code: "ANTIGRAVITY_ARGS_MANAGED" });
  const capability = await detectRunner({
    runnerId: "antigravity", cwd, environment, cache: false,
    resolveLaunch: async options => {
      if (/^agy(?:\.exe)?$/iu.test(cliPath)) return resolveRunnerLaunch(options);
      await access(cliPath);
      return { executable: cliPath, prefixArgs: [] };
    },
  });
  if (capability.ready !== true) throw Object.assign(new Error(capability.message || "Antigravity 尚未就绪，请先检查安装和登录状态"), {
    code: capability.error?.code || "ANTIGRAVITY_NOT_READY",
  });
  if (model && !capability.models.includes(model)) throw Object.assign(new Error("所选模型不在 Antigravity 当前账号的 agy models 目录中，请刷新后重新选择"), { code: "ANTIGRAVITY_MODEL_UNAVAILABLE" });
  if (settings.connectionProbeOnly === true) return {
    ok: true, connected: true, available: true, agentVerified: false,
    testLevel: "connection", verificationLevel: "model_catalog", version: capability.version,
    models: capability.models, modelLabels: capability.modelLabels,
    message: "Antigravity 版本与当前账号模型目录检查通过；未提交推理任务",
  };
  const inference = await runAgent({
    engine: "antigravity", prompt: "只回复 ANTIGRAVITY_CLI_OK", cwd, model,
    cliPath: capability.cliPath || cliPath, prefixArgs: capability.prefixArgs || [], environment,
    lightweightGeneral: true, agentPermissionMode: "shensi_only",
    timeoutMs: Math.min(Math.max(Number(settings.timeoutMs) || 120_000, 10_000), 600_000),
  });
  if (String(inference.text || "").trim() !== "ANTIGRAVITY_CLI_OK") throw Object.assign(new Error("Antigravity 已返回文本，但连接测试口令不匹配"), { code: "ANTIGRAVITY_PROBE_RESPONSE_MISMATCH" });
  return {
    ok: true, connected: true, available: true, agentVerified: true,
    testLevel: "real_inference", verificationLevel: "real_inference",
    actualModel: inference.actualModel || model, sessionId: inference.sessionId,
    message: "Antigravity CLI 真实文字推理连接成功",
  };
};
