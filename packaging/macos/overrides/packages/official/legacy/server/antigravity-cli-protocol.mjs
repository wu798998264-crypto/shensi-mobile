// agy 1.5.18 contract: https://antigravity.google/docs/cli/headless/
// Keep this protocol separate from CodeBuddy/custom CLI output heuristics.
export const parseAntigravityModels = (output = "") => {
  const labels = new Map();
  for (const line of String(output).split(/\r?\n/u)) {
    const match = line.match(/^\s*([a-z0-9][a-z0-9._:+/-]*)\t+(.+?)\s*$/iu);
    if (match && !/^(?:model_?id|id)$/iu.test(match[1])) labels.set(match[1], match[2]);
  }
  return { models: [...labels.keys()], modelLabels: Object.fromEntries(labels) };
};

export const antigravityDiagnostic = (detail = "", fallback = "Antigravity 调用失败") => {
  const source = String(detail);
  if (/(?:not logged|not signed|sign[ -]?in|log[ -]?in required|authentication required|unauthenticated|invalid.*token|token.*expired)/iu.test(source)) {
    return { code: "ANTIGRAVITY_AUTH_REQUIRED", message: "Antigravity 已安装但未登录或登录已失效，请在终端运行 agy 完成登录，再重新检查", retryable: false };
  }
  if (/(?:unknown|invalid|unsupported|unavailable|not found|not available).*model|model.*(?:unknown|invalid|unsupported|unavailable|not found|not available)/iu.test(source)) {
    return { code: "ANTIGRAVITY_MODEL_UNAVAILABLE", message: "Antigravity 当前账号无法使用所选模型，请刷新 agy models 后重新选择", retryable: false };
  }
  if (/quota|resource_exhausted|credits? (?:exhausted|insufficient)|rate.?limit|too many requests|\b429\b/iu.test(source)) {
    return { code: "ANTIGRAVITY_QUOTA_LIMITED", message: "Antigravity 返回额度不足或限流，请检查该账号额度后重试", retryable: false };
  }
  if (/timed?\s*out|timeout|ETIMEDOUT|deadline/iu.test(source)) {
    return { code: "ANTIGRAVITY_TIMEOUT", message: "Antigravity 响应超时，请检查 CLI 网络连接后重试", retryable: true };
  }
  if (/permission|approval|denied/iu.test(source)) {
    return { code: "ANTIGRAVITY_PERMISSION_REQUIRED", message: "Antigravity 操作未获授权，请检查当前权限模式与 CLI 权限设置", retryable: false };
  }
  return { code: "ANTIGRAVITY_CLI_FAILED", message: fallback, retryable: true };
};

export const antigravityInput = ({ prompt, model = "", workspace, settingsFile }) => {
  const args = ["--output-format", "stream-json", "--add-dir", workspace, "--disable-slash-commands", "--settings", settingsFile];
  if (model) args.push("--model", model);
  // Leave ample room for executable, workspace and Windows argument quoting.
  if (Buffer.byteLength(prompt, "utf8") <= 8_000) return { args: [...args, "-p", prompt], input: undefined };
  return {
    args: [...args, "--input-format", "stream-json"],
    input: `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`,
  };
};

export const parseAntigravityOutput = (stdout = "", { partial = false } = {}) => {
  const raw = String(stdout);
  const source = partial ? raw.slice(0, raw.lastIndexOf("\n") + 1) : raw;
  let events;
  try { events = [JSON.parse(source)]; }
  catch { events = source.split(/\r?\n/u).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  let text = "", sessionId = "", actualModel = "", error = "", status = "", terminal = false;
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (event.event === "init") {
      sessionId = String(event.conversation_id || sessionId);
      actualModel = String(event.init?.model || actualModel);
    }
    if (event.event === "step_update") {
      const step = event.step_update || {};
      sessionId = String(step.conversation_id || sessionId);
      if (!terminal && (!step.step_type || step.step_type === "agent_response") && typeof step.text_delta === "string") text += step.text_delta;
    }
    if (event.event === "error") error = String(event.error?.message || event.error || "Antigravity 返回错误事件");
    const result = event.event === "result" ? event.result : !event.event && typeof event.status === "string" ? event : null;
    if (result && typeof result === "object") {
      terminal = true;
      status = String(result.status || "").toUpperCase();
      sessionId = String(result.conversation_id || sessionId);
      actualModel = String(result.model || actualModel);
      text = typeof result.response === "string" ? result.response : "";
      error = status === "SUCCESS" ? "" : String(result.error?.message || result.error || `Antigravity 终态：${status || "缺失状态"}`);
    }
  }
  return { text, sessionId, actualModel, actualProvider: "", error, status, terminal };
};
