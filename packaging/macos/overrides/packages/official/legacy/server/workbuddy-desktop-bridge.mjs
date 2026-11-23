import {nodeRuntimeExecutable} from './node-runtime.mjs';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import net from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { readWorkBuddyDesktopCatalog } from './workbuddy-model-catalog.mjs';

const execFileAsync = promisify(execFile);
const clean = (value = "") => String(value ?? "").replace(/\0/gu, "").trim();
export const workBuddyToolPermission = (params = {}, nativeHost = null) => {
  const toolCall = params.toolCall || {};
  const name = clean(toolCall.rawInput?.toolName || toolCall._meta?.["codebuddy.ai/toolName"] || toolCall.title);
  const registered = new Set((nativeHost?.toolNames || []).flatMap((tool) => [tool, `mcp__shensi__${tool}`, `shensi_${tool}`]));
  const permitted = Boolean(name && registered.has(name));
  const option = (params.options || []).find((item) => item.kind === (permitted ? "allow_once" : "reject_once"));
  return { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } };
};
const DEFAULT_TIMEOUT_MS = 1_800_000;
const BRIDGE_READINESS_WINDOW_MS = 12_000;
const BRIDGE_POLL_INTERVAL_MS = 500;
const WBIPC_HANDSHAKE_TIMEOUT_MS = 5_000;
const WBIPC_IO_TIMEOUT_MS = 30_000;
const ACP_HEADERS = { "x-codebuddy-request": "1", "content-type": "application/json", accept: "application/json, text/event-stream" };
const workBuddyAuthError = (message, statusCode = 0) => Object.assign(new Error(message), {
  code: "WORKBUDDY_AUTH_REQUIRED",
  statusCode: Number(statusCode) || 0,
});
const workBuddyChannelAuthError = statusCode => Object.assign(new Error(`WorkBuddy 本机 ACP 通道拒绝连接（HTTP ${statusCode}）；这是通道认证失败，不能据此判断桌面账号未登录`), {
  code: "WORKBUDDY_ACP_CHANNEL_AUTH_REQUIRED", statusCode, authScope: "local_acp_channel",
});
export const workBuddyDesktopRequestError = (original) => {
  const message = String(original?.message || original || 'WorkBuddy 桌面请求失败');
  const timeout = /upstream timed out after (\d+)ms/iu.exec(message);
  if (timeout) return Object.assign(new Error(`WorkBuddy 官方桌面请求通道等待上游超过 ${Number(timeout[1]) / 1000} 秒，已终止本次请求；这不是未登录，神思未自动重提。`), {
    code: 'WORKBUDDY_DESKTOP_UPSTREAM_TIMEOUT', upstreamTimeoutMs: Number(timeout[1]), retryable: false, cause: original,
  });
  const limit = /response exceeds inline limit of (\d+) bytes/iu.exec(message);
  if (!limit) return Object.assign(new Error(message), { code: original?.code || 'WORKBUDDY_DESKTOP_REQUEST_FAILED' });
  return Object.assign(new Error(`WorkBuddy 桌面官方桥接返回的数据超过 ${Math.round(Number(limit[1]) / 1024)}KB 上限，响应在进入神思前已被截断；这不是未登录。请使用 WorkBuddy 官方桌面对话完成本次长响应，或等待官方大响应桥接支持。神思未重提本任务，也未将截断内容当作成功结果。`), {
    code: 'WORKBUDDY_DESKTOP_INLINE_LIMIT', responseLimitBytes: Number(limit[1]), retryable: false, cause: original,
  });
};

const configRoot = (environment = process.env) => clean(environment.WORKBUDDY_CONFIG_DIR || environment.CODEBUDDY_CONFIG_DIR)
  || join(homedir(), ".workbuddy");

const resolvedProductConfigPath = async (environment = process.env) => {
  return (await readWorkBuddyDesktopCatalog(configRoot(environment))).manifest;
};

const resolvedProductModels = async (environment = process.env) => {
  return (await readWorkBuddyDesktopCatalog(configRoot(environment))).entries;
};

const disambiguateWorkBuddyModelNames = (models = [], metadata = []) => {
  const metadataById = new Map(metadata.map((item) => [item.id, item]));
  const counts = new Map();
  for (const item of models) counts.set(item.name, (counts.get(item.name) || 0) + 1);
  return models.map((item) => ({
    ...item,
    name: counts.get(item.name) > 1
      ? `${item.name}（${metadataById.get(item.id)?.credits || item.credits ? `积分倍率 ${metadataById.get(item.id)?.credits || item.credits}` : item.id}）`
      : item.name,
  }));
};

const controlPipePath = (root, uuid) => `\\\\.\\pipe\\workbuddy-${createHash("sha1").update(resolve(root)).digest("hex").slice(0, 12)}-sidecar-control-${uuid}`;

// Official prewarm servers have --serve --port 0 without a session id.
// They still require an actual desktop daemon owner and an ACP auth check.
export const workBuddyDesktopGatewayQuery = String.raw`
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)
$byId = @{}
foreach ($item in $all) { $byId[[int]$item.ProcessId] = $item }
$rows = @($all | Where-Object { $_.Name -in @('node.exe','WorkBuddy.exe') -and $_.CommandLine -match '(?i)codebuddy.*--serve' } | ForEach-Object {
  $processId = $_.ProcessId
  $parents = @()
  $desktopOwner = $false
  $parentId = [int]$_.ParentProcessId
  for ($i = 0; $i -lt 6 -and $parentId -gt 0; $i++) {
    $parent = $byId[$parentId]
    if (-not $parent) { break }
    $parents += [string]$parent.CommandLine
    if ($parent.Name -eq 'WorkBuddy.exe' -and $parent.CommandLine -match '(?i)(?:^|[\\/"\s])(?:sidecar-entry|daemon-app-server-entry)\.js(?:\s|"|$)') { $desktopOwner = $true }
    $parentId = [int]$parent.ParentProcessId
  }
  $session = $_.CommandLine -match '(?i)--session-id\s+[0-9a-f-]{8,}'
  $prewarm = $_.CommandLine -match '(?i)--port\s+0(?:\s|"|$)'
  $ports = @(Get-NetTCPConnection -State Listen -OwningProcess $processId -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort)
  [pscustomobject]@{ ProcessId=$processId; ParentProcessId=$_.ParentProcessId; Name=$_.Name; CommandLine=$_.CommandLine; ParentChain=($parents -join [Environment]::NewLine); DesktopOwned=($_.Name -eq 'WorkBuddy.exe' -and $desktopOwner -and ($session -or $prewarm)); Ports=$ports }
})
ConvertTo-Json -InputObject $rows -Compress
`;

/**
 * A listening ACP port is not sufficient evidence of a WorkBuddy desktop
 * session. Only an official daemon/sidecar-owned WorkBuddy.exe session or
 * prewarm child can carry the desktop credential bootstrap.
 */
export const isDesktopOwnedGateway = (candidate = {}) => Boolean(
  candidate?.gateway
  && candidate?.desktopOwned === true
  && /^workbuddy\.exe$/iu.test(clean(candidate?.processName)),
);

const wbipcDiscoveryPath = (environment = process.env) => join(configRoot(environment), "wbipc", "endpoint.json");

const wbipcTicketId = (ticket) => createHash("sha256").update(String(ticket), "utf8").digest("hex").slice(0, 16);

const wbipcTranscript = (role, { protocol = 1, endpoint, clientNonce, serverNonce }) => {
  const parts = [role === "server" ? "wbipc-s" : "wbipc-c", String(protocol), endpoint, clientNonce, serverNonce];
  const chunks = [];
  for (const part of parts) {
    const value = Buffer.from(String(part), "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length, 0);
    chunks.push(length, value);
  }
  return Buffer.concat(chunks);
};

const wbipcProof = (ticket, role, transcript) => createHmac("sha256", Buffer.from(String(ticket), "utf8"))
  .update(wbipcTranscript(role, transcript)).digest("base64url");

const safeProofEqual = (left, right) => {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

const wbipcReadFrame = (socket, timeoutMs = WBIPC_HANDSHAKE_TIMEOUT_MS) => new Promise((resolveFrame, rejectFrame) => {
  let buffer = "";
  let settled = false;
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.removeListener("data", onData);
    socket.removeListener("error", onError);
    socket.removeListener("close", onClose);
    if (error) rejectFrame(error); else resolveFrame(value);
  };
  const onData = (chunk) => {
    buffer += String(chunk || "");
    const index = buffer.indexOf("\n");
    if (index < 0) return;
    const line = buffer.slice(0, index);
    try { finish(null, JSON.parse(line)); } catch (error) { finish(error); }
  };
  const onError = (error) => finish(error);
  const onClose = () => finish(new Error("WorkBuddy WBIPC 端点在握手期间关闭"));
  const timer = setTimeout(() => finish(new Error("WorkBuddy WBIPC 握手超时")), timeoutMs);
  socket.setEncoding("utf8");
  socket.on("data", onData);
  socket.once("error", onError);
  socket.once("close", onClose);
});

const probeWbipcEndpoint = async ({ endpoint, ticket, timeoutMs = WBIPC_HANDSHAKE_TIMEOUT_MS } = {}) => {
  if (!endpoint || !ticket) return null;
  const socket = net.createConnection(endpoint);
  const close = () => { try { socket.destroy(); } catch {} };
  const clientNonce = randomBytes(16).toString("base64url");
  try {
    await new Promise((resolveConnect, rejectConnect) => {
      const timer = setTimeout(() => rejectConnect(new Error("WorkBuddy WBIPC 连接超时")), timeoutMs);
      socket.once("connect", () => { clearTimeout(timer); resolveConnect(); });
      socket.once("error", (error) => { clearTimeout(timer); rejectConnect(error); });
    });
    socket.write(`${JSON.stringify({ type: "session_hello", protocol_min: 1, protocol_max: 1, client_nonce: clientNonce, ticket_id: wbipcTicketId(ticket), client: { kind: "shensi", id: "shensi-bridge", version: "1" } })}\n`);
    const challenge = await wbipcReadFrame(socket, timeoutMs);
    if (challenge?.type !== "session_challenge") throw new Error(`WorkBuddy WBIPC 握手被拒绝：${clean(challenge?.code || challenge?.type)}`);
    const transcript = { protocol: 1, endpoint, clientNonce, serverNonce: clean(challenge.server_nonce) };
    if (!transcript.serverNonce || !safeProofEqual(challenge.server_proof, wbipcProof(ticket, "server", transcript))) throw new Error("WorkBuddy WBIPC 服务端证明无效");
    socket.write(`${JSON.stringify({ type: "session_prove", client_proof: wbipcProof(ticket, "client", transcript) })}\n`);
    const ack = await wbipcReadFrame(socket, timeoutMs);
    if (ack?.type !== "session_hello_ack") throw new Error(`WorkBuddy WBIPC 握手确认失败：${clean(ack?.code || ack?.type)}`);
    return { endpoint, pipes: Array.isArray(ack.pipes) ? ack.pipes : [], connectionEpoch: clean(ack.connection_epoch) };
  } finally {
    close();
  }
};

// The desktop's authenticated request broker is available before it lazily
// creates an ACP runtime. The broker applies its own account headers; Shensi
// never reads the desktop access token or takes a process from its warm pool.
export const openWorkBuddyRequestClient = async ({ endpoint, ticket, signal, timeoutMs = WBIPC_HANDSHAKE_TIMEOUT_MS } = {}) => {
  if (signal?.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
  const socket = net.createConnection(endpoint);
  const pending = new Map();
  let buffer = "", closed = false, sequence = 0, handshake = null;
  const fail = (error) => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", abort);
    handshake?.reject(error); handshake = null;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear(); socket.destroy();
  };
  const abort = () => fail(Object.assign(new Error("任务已停止"), { name: "AbortError" }));
  const wait = (register, unregister, ms) => new Promise((resolveWait, rejectWait) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); unregister();
      if (error) rejectWait(error); else resolveWait(value);
    };
    const timer = setTimeout(() => {
      const error = Object.assign(new Error("WorkBuddy 桌面请求等待超时，已停止等待；未自动重新提交"), { code: "WORKBUDDY_DESKTOP_REQUEST_TIMEOUT" });
      finish(error); fail(error);
    }, ms);
    register({ resolve: (value) => finish(null, value), reject: (error) => finish(error) });
  });
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 2_000_000) { fail(new Error("WorkBuddy 本地响应超过安全上限")); return; }
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let frame;
      try { frame = JSON.parse(line); } catch { fail(new Error("WorkBuddy 本地响应格式无效")); return; }
      if (frame.type === "pipe_revoked") { fail(Object.assign(new Error("WorkBuddy 账号会话已变更，请重新连接本轮任务"), { code: "WORKBUDDY_DESKTOP_SESSION_CHANGED" })); return; }
      if (frame.type?.startsWith("session_")) handshake?.resolve(frame);
      else if (frame.id != null) {
        const entry = pending.get(String(frame.id));
        if (frame.error) entry?.reject(workBuddyDesktopRequestError(frame.error));
        else entry?.resolve(frame.result);
      }
    }
  });
  socket.on("error", fail);
  socket.on("close", () => fail(Object.assign(new Error("WorkBuddy 桌面连接已关闭；本次任务未重新提交"), { code: "WORKBUDDY_DESKTOP_CONNECTION_CLOSED" })));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const handshakeSend = (frame) => {
    const promise = wait((entry) => { handshake = entry; }, () => { handshake = null; }, timeoutMs);
    socket.write(`${JSON.stringify(frame)}\n`);
    return promise;
  };
  const rpc = (method, params, ms = 55_000, mode) => {
    if (closed || signal?.aborted) return Promise.reject(Object.assign(new Error("WorkBuddy 连接已停止"), { name: signal?.aborted ? "AbortError" : "Error" }));
    const id = String(++sequence);
    const promise = wait((entry) => pending.set(id, entry), () => pending.delete(id), ms);
    socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params, ...(mode ? { mode } : {}) })}\n`);
    return promise;
  };
  try {
    if (closed) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    await wait((entry) => { handshake = entry; socket.once("connect", entry.resolve); }, () => { handshake = null; }, timeoutMs);
    const clientNonce = randomBytes(16).toString("base64url");
    const challenge = await handshakeSend({ type: "session_hello", protocol_min: 1, protocol_max: 1, client_nonce: clientNonce, ticket_id: wbipcTicketId(ticket), client: { kind: "shensi", id: "shensi-bridge", version: "1" } });
    const transcript = { protocol: 1, endpoint, clientNonce, serverNonce: clean(challenge.server_nonce) };
    if (challenge.type !== "session_challenge" || !transcript.serverNonce || !safeProofEqual(challenge.server_proof, wbipcProof(ticket, "server", transcript))) throw new Error("WorkBuddy 本地服务身份校验失败");
    const ack = await handshakeSend({ type: "session_prove", client_proof: wbipcProof(ticket, "client", transcript) });
    if (ack.type !== "session_hello_ack" || !ack.pipes?.includes("wb.request")) throw new Error("WorkBuddy 尚未提供已登录的本地请求通道");
    const pipe = await rpc("broker/GetPipe", { pipe: "wb.request" }, timeoutMs);
    if (pipe?.channel !== "c:wb.request" || !pipe.methods?.includes("http.fetch")) throw new Error("WorkBuddy 本地请求通道不可用");
    return {
      // Non-secret broker metadata only; does not open another pipe, start a
      // session or change the inference route. Used by read-only diagnostics.
      capabilities: { pipes: [...ack.pipes], requestMethods: [...pipe.methods] },
      // Only the original WorkBuddy text inference route is exposed here.
      request: (body, ms) => rpc(`${pipe.channel}/http.fetch`, {
        method: "POST", path: "/v2/chat/completions",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body_b64: Buffer.from(JSON.stringify(body)).toString("base64"),
      }, Math.min(55_000, ms || 55_000), "call"),
      close: () => fail(Object.assign(new Error("WorkBuddy 本轮连接已结束"), { code: "WORKBUDDY_REQUEST_FINISHED" })),
    };
  } catch (error) { fail(error); throw error; }
};

export const parseWorkBuddyDesktopCompletion = (response) => {
  const body = Buffer.from(response?.body_b64 || "", "base64").toString("utf8");
  const status = Number(response?.status) || 0;
  const failure = (payload, fallback) => {
    const detail = clean(payload?.displayMsg?.zh || payload?.error?.message || payload?.msg || payload?.message || fallback).slice(0, 1200);
    const original = clean(payload?.msg || payload?.error?.message);
    const message = `WorkBuddy 返回失败${status ? `（HTTP ${status}）` : ""}：${detail}${original && original !== detail ? `；${original.slice(0, 500)}` : ""}`;
    if (status === 401) return workBuddyAuthError(message, status);
    return Object.assign(new Error(message), { code: status === 429 ? "WORKBUDDY_RATE_LIMITED" : "WORKBUDDY_PROVIDER_FAILED", statusCode: status, providerCode: payload?.code, requestId: payload?.requestId });
  };
  if (status < 200 || status >= 300) {
    let payload; try { payload = JSON.parse(body); } catch {}
    throw failure(payload, body || "上游未返回错误说明");
  }
  if (body.trimStart().startsWith("{")) {
    let payload; try { payload = JSON.parse(body); } catch {}
    throw failure(payload, "上游未返回所请求的流式结果");
  }
  let text = "", finish = "", model = "", requestId = "", usage = null;
  const calls = new Map();
  for (const line of body.split(/\r?\n/u)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let frame; try { frame = JSON.parse(data); } catch { throw failure(null, "流式响应格式损坏"); }
    if (frame.error || (frame.code && !frame.choices)) throw failure(frame, "上游流中断");
    const choice = frame.choices?.find((item) => item.index === 0) || frame.choices?.[0];
    if (typeof choice?.delta?.content === "string") text += choice.delta.content;
    // Reasoning and tool-phase narration never become the delivered answer.
    for (const part of choice?.delta?.tool_calls || []) {
      const index = Number(part.index);
      if (!Number.isInteger(index) || index < 0) throw failure(null, "工具调用序号无效");
      const call = calls.get(index) || { id: "", type: "function", function: { name: "", arguments: "" } };
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      calls.set(index, call);
    }
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (frame.model) model = frame.model;
    if (frame.id) requestId = frame.id;
    if (frame.usage) usage = frame.usage;
  }
  if (!["stop", "tool_calls"].includes(finish)) throw failure(null, finish === "length" ? "回复达到上游长度限制，未当作完整结果" : "上游未返回完整结束标记，未当作生成成功");
  const toolCalls = [...calls.values()];
  if (finish === "tool_calls" && !toolCalls.length) throw failure(null, "上游工具调用缺失");
  if (toolCalls.some((call) => !call.id || !call.function.name)) throw failure(null, "上游工具调用不完整");
  return { text, toolCalls, model, requestId, usage };
};

export const workBuddyRequestControls = (definition = {}, { reasoningEffort = '', maxOutputTokens = 0 } = {}) => {
  const controls = {};
  if (reasoningEffort) {
    if (!definition.reasoning?.supportedEfforts?.includes(reasoningEffort)) throw Object.assign(new Error('WorkBuddy 当前模型不支持所选推理强度，未发起生成'), { code: 'WORKBUDDY_REASONING_UNSUPPORTED' });
    controls.reasoning_effort = reasoningEffort;
    controls.reasoning_summary = 'auto';
  }
  if (maxOutputTokens) {
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > Number(definition.maxOutputTokens || 0)) throw Object.assign(new Error('WorkBuddy 当前模型不支持本次输出预算，未发起生成'), { code: 'WORKBUDDY_OUTPUT_BUDGET_UNSUPPORTED' });
    controls.max_tokens = maxOutputTokens;
  }
  return controls;
};

export const runWorkBuddyDesktopRequest = async ({ sidecar, prompt, model, nativeHost, signal, timeoutMs = DEFAULT_TIMEOUT_MS, onEvent, environment = process.env, openClient = openWorkBuddyRequestClient, reasoningEffort = '', maxOutputTokens = 0 } = {}) => {
  const available = await resolvedProductModels(environment);
  const selectedModel = resolveWorkBuddyModelId(model, available) || (!model || model === "auto" ? available[0]?.id : "");
  if (!selectedModel) throw Object.assign(new Error(`WorkBuddy 当前模型目录没有模型“${clean(model)}”`), { code: "WORKBUDDY_MODEL_UNAVAILABLE" });
  let requestControls = {};
  if (reasoningEffort || maxOutputTokens) {
    const product = JSON.parse(await readFile(await resolvedProductConfigPath(environment), 'utf8'));
    requestControls = workBuddyRequestControls(product.models?.find(item => item.id === selectedModel), { reasoningEffort, maxOutputTokens });
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const deadline = Date.now() + timeoutMs;
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  let client;
  const mcp = async (method, params) => {
    if (controller.signal.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    const result = await fetch(nativeHost.url, { method: "POST", headers: { ...nativeHost.headers, "content-type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }) });
    if (!result.ok) throw new Error(`神思工具连接失败（HTTP ${result.status}）`);
    const payload = await result.json();
    if (payload.error) throw new Error(payload.error.message || "神思工具调用失败");
    return payload.result;
  };
  try {
    client = await openClient({ endpoint: sidecar.wbipcEndpoint, ticket: sidecar.wbipcTicket, signal: controller.signal });
    const catalog = nativeHost?.url ? (await mcp("tools/list", {})).tools || [] : [];
    const permitted = new Map(catalog.filter((tool) => nativeHost.toolNames?.includes(tool.name)).map((tool) => [`mcp__shensi__${tool.name}`, tool]));
    const tool = permitted.size ? [{ type: "function", function: {
      name: "DeferExecuteTool", description: "调用本轮神思授权工具。使用下列精确 toolName 与对应 input 参数：\n" + JSON.stringify([...permitted].map(([name, item]) => ({ name, description: item.description, inputSchema: item.inputSchema }))),
      parameters: { type: "object", properties: { toolName: { type: "string", enum: [...permitted.keys()] }, input: { type: "object", additionalProperties: true } }, required: ["toolName", "input"], additionalProperties: false },
    } }] : [];
    const messages = [{ role: "user", content: String(prompt || "") }];
    let toolCount = 0;
    for (let step = 0; step < 24; step++) {
      if (controller.signal.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
      const response = await client.request({ model: selectedModel, messages, stream: true, ...requestControls, ...(tool.length ? { tools: tool, tool_choice: "auto" } : {}) }, Math.max(1, deadline - Date.now()));
      if (controller.signal.aborted) throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
      const result = parseWorkBuddyDesktopCompletion(response);
      if (!result.toolCalls.length) {
        if (!result.text.trim()) throw Object.assign(new Error("WorkBuddy 已结束，但没有返回正式正文"), { code: "WORKBUDDY_ACP_EMPTY_TEXT" });
        onEvent?.({ type: "text", phase: "text_delta", text: result.text, part: { type: "text", id: "workbuddy-desktop-request", text: result.text } });
        return { text: result.text.trim(), sessionId: result.requestId, actualProvider: "WorkBuddy", actualModel: result.model || selectedModel, executionRuntime: "workbuddy_desktop_request", permissionMode: "shensi_only", usage: result.usage };
      }
      messages.push({ role: "assistant", content: result.text || null, tool_calls: result.toolCalls });
      for (const call of result.toolCalls) {
        if (++toolCount > 32) throw new Error("WorkBuddy 本轮工具调用已达到上限，已停止");
        let args; try { args = JSON.parse(call.function.arguments); } catch { throw new Error("WorkBuddy 工具参数不是有效 JSON，未执行工具"); }
        const target = call.function.name === "DeferExecuteTool" ? permitted.get(args?.toolName) : null;
        if (!target) throw Object.assign(new Error("WorkBuddy 请求了未获本轮授权的工具，已阻止执行"), { code: "WORKBUDDY_TOOL_NOT_AUTHORIZED" });
        if (!args.input || typeof args.input !== "object" || Array.isArray(args.input)) throw new Error("WorkBuddy 工具 input 必须是参数对象，未执行工具");
        const output = await mcp("tools/call", { name: target.name, arguments: args.input });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
      }
    }
    throw new Error("WorkBuddy 本轮推理步数已达到上限，未返回正式正文");
  } catch (error) {
    if (timedOut) throw Object.assign(new Error("WorkBuddy 本轮任务已超时，已停止连接；未自动重新提交"), { code: "WORKBUDDY_DESKTOP_REQUEST_TIMEOUT", cause: error });
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); client?.close(); }
};

const powershell = async (command, timeoutMs = 5_000) => {
  const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 256 * 1024,
  });
  return String(result.stdout || "");
};

const listSidecars = async ({ environment = process.env } = {}) => {
  if (process.platform !== "win32") return [];
  // Unit/contract tests pass synthetic environments.  Never inspect the
  // developer's real WorkBuddy process in that mode, otherwise a fixture
  // intended to represent a logged-out runner would be contaminated by the
  // current desktop session.
  const synthetic = environment !== process.env
    && environment?.SHENSI_WORKBUDDY_BRIDGE_RUNTIME !== "1"
    && environment?.SHENSI_ALLOW_WORKBUDDY_BRIDGE_TEST !== "1";
  if (synthetic) return [];
  const raw = await powershell("Get-CimInstance Win32_Process -Filter \"Name='WorkBuddy.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress").catch(() => "");
  let rows;
  try { rows = JSON.parse(raw || "[]"); } catch { rows = []; }
  if (!Array.isArray(rows)) rows = rows ? [rows] : [];
  const root = configRoot(environment);
  const modernRow = rows.find((row) => /WorkBuddy\.exe/iu.test(clean(row?.CommandLine)) && !/--type=|sidecar-entry\.js|daemon-app-server-entry\.js|[\\/]cli[\\/]/iu.test(clean(row?.CommandLine)));
  const desktopOwnerPid = (row) => {
    let current = row;
    for (let depth = 0; current && depth < 6; depth++) {
      if (current.ProcessId === modernRow?.ProcessId) return Number(modernRow.ProcessId) || 0;
      current = rows.find(parent => parent.ProcessId === current.ParentProcessId);
    }
    return 0;
  };
  const candidates = rows.map((row) => {
    const commandLine = clean(row?.CommandLine);
    const uuid = commandLine.match(/--control-pipe-uuid\s+([0-9a-f-]{8,})/iu)?.[1] || "";
    const executable = commandLine.match(/"([A-Za-z]:\\[^"]*?WorkBuddy\.exe)"/iu)?.[1]
      || commandLine.match(/(?:^|\s)([A-Za-z]:\\[^"]*?WorkBuddy\.exe)(?:\s|$)/iu)?.[1]
      || "";
    return uuid ? { uuid, pid: Number(row?.ProcessId) || 0, desktopPid: desktopOwnerPid(row), executable, commandLine, controlPipe: controlPipePath(root, uuid) } : null;
  }).filter(Boolean);
  // WorkBuddy 5.6+ no longer exposes --control-pipe-uuid. Its desktop daemon
  // publishes a ticketed WBIPC endpoint instead. Keep the old sidecar result
  // shape intact and append a modern candidate only after the endpoint file is
  // structurally valid; liveness and HMAC proof are checked by discoverSidecar.
  const modernCommandLine = clean(modernRow?.CommandLine);
  const modernExecutable = modernCommandLine.match(/"([A-Za-z]:\\[^"]*?WorkBuddy\.exe)"/iu)?.[1]
    || modernCommandLine.match(/(?:^|\s)([A-Za-z]:\\[^\s]*?WorkBuddy\.exe)(?:\s|$)/iu)?.[1]
    || "";
  const discovery = await readFile(wbipcDiscoveryPath(environment), "utf8").catch(() => "");
  if (discovery && modernExecutable) {
    try {
      const payload = JSON.parse(discovery);
      if (clean(payload?.endpoint) && clean(payload?.ticket)) candidates.push({
        modern: true,
        pid: Number(modernRow?.ProcessId) || 0,
        desktopPid: Number(modernRow?.ProcessId) || 0,
        executable: modernExecutable,
        commandLine: modernCommandLine,
        wbipcEndpoint: clean(payload.endpoint),
        wbipcTicket: clean(payload.ticket),
      });
    } catch {}
  }
  // WorkBuddy 5.6 keeps a logged-in CodeBuddy gateway alive as a separate
  // `codebuddy --serve --port 0` child.  Starting a fresh `codebuddy --acp`
  // process from Shensi bypasses the desktop daemon's credential bootstrap and
  // therefore always answers `Authentication required`.  Reuse the gateway's
  // authenticated ACP HTTP endpoint instead.  The port is kernel-assigned, so
  // discover it from the listening socket owned by that exact child process;
  // never guess a fixed port and never read any token from disk.
  const serverRaw = await powershell(
    workBuddyDesktopGatewayQuery,
    5_000,
  ).catch(() => "");
  let serverRows;
  try { serverRows = JSON.parse(serverRaw || "[]"); } catch { serverRows = []; }
  if (!Array.isArray(serverRows)) serverRows = serverRows ? [serverRows] : [];
  for (const row of serverRows) {
    const ports = (Array.isArray(row?.Ports) ? row.Ports : [row?.Ports])
      .map((port) => Number(port) || 0)
      .filter((port) => port > 0 && port < 65536);
    for (const port of ports) {
      candidates.push({
        modern: true,
        gateway: true,
        desktopOwned: row?.DesktopOwned === true,
        pid: Number(row?.ProcessId) || 0,
        parentPid: Number(row?.ParentProcessId) || 0,
        processName: clean(row?.Name),
        commandLine: clean(row?.CommandLine),
        acpEndpoint: `http://127.0.0.1:${port}/api/v1/acp`,
      });
    }
  }
  return candidates;
};

export const controlRequest = (pipe, request, timeoutMs = 30_000) => new Promise((resolveRequest, rejectRequest) => {
  const socket = net.createConnection(pipe);
  let buffer = "";
  let settled = false;
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.destroy();
    if (error) rejectRequest(error); else resolveRequest(value);
  };
  const timer = setTimeout(() => finish(new Error("WorkBuddy sidecar 控制通道超时")), timeoutMs);
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (!settled && buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const payload = JSON.parse(line);
        // The official sidecar broadcasts session.exited to all control clients.
        // A notification (or another request's reply) is not this request's result.
        if (payload?.method || payload?.id !== request.id) continue;
        if (payload?.error) finish(Object.assign(new Error(payload.error.message || "WorkBuddy sidecar 请求失败"), { code: payload.error.code }));
        else finish(null, payload?.result);
      } catch (error) { finish(error); }
    }
  });
  socket.once("error", (error) => finish(error));
  socket.once("close", () => finish(new Error("WorkBuddy sidecar 控制连接在返回本次请求结果前已关闭")));
  socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
});

const discoverSidecar = async (options = {}) => {
  const candidates = (await listSidecars(options)).filter(candidate => !options.desktopRequestOnly
    || (candidate.modern && !candidate.gateway && candidate.desktopPid === options.desktopPid));
  // The official sidecar is the only path that receives WorkBuddy's
  // credential-protection bootstrap.  A raw `codebuddy --serve` started by a
  // shell (or by an older Shensi probe) can expose an ACP port while returning
  // `Authentication required`; treating that port as the desktop session is
  // the source of the historic "logged out / bridge unavailable" flip-flop.
  // Prefer sidecar-control, then a desktop-owned session/prewarm gateway.
  // Never select a bare node/codebuddy gateway, and do not turn WBIPC liveness
  // alone into a usable ACP session.
  const ordered = [
    ...candidates.filter((candidate) => !candidate.gateway && !candidate.modern),
    ...candidates.filter((candidate) => isDesktopOwnedGateway(candidate)),
    ...candidates.filter((candidate) => candidate.modern && !candidate.gateway),
  ];
  for (const candidate of ordered) {
    if (candidate.gateway && candidate.acpEndpoint) {
      return { ...candidate, direct: true };
    }
    if (candidate.modern) {
      const probe = await probeWbipcEndpoint({ endpoint: candidate.wbipcEndpoint, ticket: candidate.wbipcTicket }).catch(() => null);
      if (probe?.pipes?.includes("wb.request")) return { ...candidate, wbipc: probe, desktopRequest: true };
      continue;
    }
    const ping = await controlRequest(candidate.controlPipe, { jsonrpc: "2.0", id: 1, method: "sidecar.ping", params: {} }).catch(() => null);
    if (ping?.pid) return { ...candidate, ping };
  }
  return null;
};

const waitForSidecar = async ({ environment = process.env, signal = null, timeoutMs = BRIDGE_READINESS_WINDOW_MS } = {}) => {
  // Synthetic environments used by contract tests intentionally do not touch
  // the desktop process table. Keep those calls immediate; the bounded wait
  // is only for the real first-use WorkBuddy startup race.
  const synthetic = environment !== process.env
    && environment?.SHENSI_WORKBUDDY_BRIDGE_RUNTIME !== "1"
    && environment?.SHENSI_ALLOW_WORKBUDDY_BRIDGE_TEST !== "1";
  const windowMs = synthetic ? 0 : Math.min(BRIDGE_READINESS_WINDOW_MS, Math.max(0, Number(timeoutMs) || BRIDGE_READINESS_WINDOW_MS));
  const deadline = Date.now() + windowMs;
  let sidecar = await discoverSidecar({ environment });
  while (!sidecar && Date.now() < deadline) {
    if (signal?.aborted) throw Object.assign(new Error("WorkBuddy ACP 请求已取消"), { name: "AbortError" });
    await new Promise((resolveDelay, rejectDelay) => {
      const timer = setTimeout(() => { signal?.removeEventListener?.("abort", abort); resolveDelay(); }, Math.min(BRIDGE_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
      const abort = () => { clearTimeout(timer); signal?.removeEventListener?.("abort", abort); rejectDelay(Object.assign(new Error("WorkBuddy ACP 请求已取消"), { name: "AbortError" })); };
      signal?.addEventListener?.("abort", abort, { once: true });
      timer.unref?.();
    }).catch((error) => { if (error?.name === "AbortError") throw error; });
    sidecar = await discoverSidecar({ environment });
  }
  return sidecar;
};

const asHeaders = (headers = {}) => Object.entries(headers || {}).filter(([name, value]) => name && value != null).map(([name, value]) => ({ name, value: String(value) }));
const toMcpServers = (nativeHost) => nativeHost?.url ? [{
  name: "shensi",
  type: "http",
  url: String(nativeHost.url),
  headers: asHeaders(nativeHost.headers),
}] : [];

export const workBuddyCliBootstrap = ({ executable, productConfigPath = "", fileExists = existsSync } = {}) => {
  const cliRoot = join(dirname(executable || ""), "resources", "app.asar.unpacked", "cli");
  const codebuddy = join(cliRoot, "bin", "codebuddy");
  const has = name => fileExists(join(cliRoot, "dist", name));
  const headless = has("codebuddy-headless.js") || has("codebuddy-headless");
  const lite = has("codebuddy-lite-wb.mjs");
  if (!executable || !fileExists(codebuddy) || (!headless && !lite && !has("codebuddy.js") && !has("codebuddy"))) {
    throw Object.assign(new Error("WorkBuddy 安装缺少可启动的官方 CLI 组件；未发起生成，不能据此判断账号未登录"), { code: "WORKBUDDY_CLI_BUNDLE_MISSING" });
  }
  return { codebuddy, environment: { ELECTRON_RUN_AS_NODE: "1", CODEBUDDY_FORCE_HEADLESS_BUNDLE: "1",
    // New desktop packages ship only lite-wb.mjs. Forcing the historical full
    // bundle exits before ACP can initialize. Keep legacy headless when present.
    CODEBUDDY_FORCE_LITE_WB_BUNDLE: !headless && lite ? "1" : "0",
    ...(productConfigPath ? { ACC_PRODUCT_CONFIG_PATH: productConfigPath } : {}),
  } };
};

export const directAcpClient = ({ executable, cwd, model = "", environment = process.env, timeoutMs = 90_000, spawnImpl = spawn, productConfigPath = "", fileExists = existsSync } = {}) => {
  const { codebuddy, environment: bootstrap } = workBuddyCliBootstrap({ executable, productConfigPath, fileExists });
  const child = spawnImpl(nodeRuntimeExecutable(), [codebuddy, "--acp", ...(clean(model) ? ["--model", clean(model)] : [])], {
    cwd: resolve(cwd || process.cwd()),
    env: {
      ...environment,
      WORKBUDDY_CONFIG_DIR: configRoot(environment),
      ...bootstrap,
      ...(environment.CODEBUDDY_NO_UPDATE_CHECK ? {} : { CODEBUDDY_NO_UPDATE_CHECK: "1" }),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "";
  let nextId = 1;
  let closed = false;
  // Vendor bootstrap/long-running diagnostics must not fill an unread pipe.
  // Do not forward these logs (which may contain private runtime details).
  child.stderr.resume();
  const pending = new Map();
  const finishPending = (error) => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  };
  const onLine = (line) => {
    if (!line.trim()) return;
    let frame;
    try { frame = JSON.parse(line); } catch { return; }
    for (const entry of pending.values()) entry.onProtocolEvent?.(frame);
    if (frame.method === "session/request_permission" && frame.id != null) {
      const handler = [...pending.values()].find((entry) => entry.onPermission)?.onPermission;
      Promise.resolve(handler ? handler(frame.params || {}) : { outcome: { outcome: "cancelled" } })
        .then((result) => { if (!closed) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result })}\n`); })
        .catch(() => { if (!closed) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { outcome: { outcome: "cancelled" } } })}\n`); });
      return;
    }
    if (frame.method === "session/update" && frame.params) for (const entry of pending.values()) entry.onUpdate?.(frame.params);
    if (frame.method) return; // Server request IDs are not client response IDs.
    if (frame?.id === undefined || frame?.id === null) return;
    const entry = pending.get(String(frame.id));
    if (!entry) return;
    pending.delete(String(frame.id));
    clearTimeout(entry.timer);
    if (frame.error) entry.reject(Object.assign(new Error(frame.error.message || "WorkBuddy ACP 请求失败"), { code: frame.error.code, data: frame.error.data }));
    else entry.resolve(frame);
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      onLine(buffer.slice(0, index).replace(/\r$/u, ""));
      buffer = buffer.slice(index + 1);
    }
  });
  child.stdin.on("error", (error) => finishPending(error));
  child.on("error", (error) => { closed = true; finishPending(Object.assign(error, { code: error.code || "WORKBUDDY_ACP_PROCESS_ERROR" })); });
  child.on("exit", (code, signal) => { closed = true; finishPending(new Error(`WorkBuddy ACP 进程已退出（${code ?? ""}${signal ? `/${signal}` : ""}）`)); });
  const request = (method, params = {}, { signal = null, timeoutMs: requestTimeoutMs = timeoutMs, onUpdate, onProtocolEvent, onPermission } = {}) => new Promise((resolveRequest, rejectRequest) => {
    if (closed) { rejectRequest(new Error("WorkBuddy ACP 会话已关闭")); return; }
    if (signal?.aborted) { rejectRequest(Object.assign(new Error("WorkBuddy ACP 请求已取消"), { name: "AbortError" })); return; }
    const id = String(nextId++);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(entry.timer); pending.delete(id); signal?.removeEventListener("abort", abort);
      error ? rejectRequest(error) : resolveRequest(value);
    };
    const entry = { resolve: value => finish(null, value), reject: error => finish(error), onUpdate, onProtocolEvent, onPermission, timer: null };
    entry.timer = setTimeout(() => {
      finish(Object.assign(new Error(`WorkBuddy ACP 请求超时：${method}`), { code: "WORKBUDDY_ACP_TIMEOUT" }));
    }, requestTimeoutMs);
    pending.set(id, entry);
    const abort = () => {
      if (settled) return;
      if (params.sessionId) try { child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: params.sessionId } })}\n`); } catch {}
      finish(Object.assign(new Error("WorkBuddy ACP 请求已取消"), { name: "AbortError" }));
    };
    signal?.addEventListener?.("abort", abort, { once: true });
    try { child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); }
    catch (error) { finish(error); }
  });
  const close = async () => {
    if (closed) return;
    closed = true;
    finishPending(new Error("WorkBuddy ACP 会话已关闭"));
    try { child.stdin.end(); } catch {}
    await new Promise((resolveClose) => {
      const timer = setTimeout(() => { try { child.kill(); } catch {} resolveClose(); }, 1_000);
      child.once("exit", () => { clearTimeout(timer); resolveClose(); });
    });
  };
  return { kind: "stdio", request, close, child, codebuddy };
};

const createHeadlessSession = async ({ sidecar, cwd, nativeHost, model = "", environment = process.env, sessionId = randomUUID(), timeoutMs = 90_000 } = {}) => {
  if (sidecar?.gateway && sidecar.acpEndpoint) {
    return { acpEndpoint: sidecar.acpEndpoint, sessionId, direct: true };
  }
  const productConfigPath = await resolvedProductConfigPath(environment);
  if (sidecar?.direct) {
    const client = directAcpClient({ executable: sidecar.executable, cwd, model, environment, timeoutMs, productConfigPath });
    return { acpEndpoint: { kind: "stdio", client }, sessionId, direct: true };
  }
  const executable = sidecar.executable || join(dirname(dirname(sidecar.commandLine || "")), "WorkBuddy.exe");
  const { codebuddy, environment: bootstrap } = workBuddyCliBootstrap({ executable, productConfigPath });
  const result = await controlRequest(sidecar.controlPipe, {
    jsonrpc: "2.0",
    id: 2,
    method: "session.create",
    params: {
      sessionId,
      command: executable,
      cwd: resolve(cwd || process.cwd()),
      port: 0,
      cols: 120,
      rows: 40,
      args: [codebuddy, "--serve", ...(clean(model) ? ["--model", clean(model)] : [])],
      env: bootstrap,
    },
  }, timeoutMs);
  if (!result?.acpEndpoint) throw new Error("WorkBuddy ACP 会话未返回连接地址");
  return result;
};

const parseSse = (source = "") => {
  const messages = [];
  for (const block of String(source).split(/\r?\n\r?\n/u)) {
    const data = block.split(/\r?\n/u).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) continue;
    try { messages.push(JSON.parse(data)); } catch {}
  }
  return messages;
};

export const acpPost = async (endpoint, credentials, message, { signal, timeoutMs = 120_000, onUpdate, onProtocolEvent, onPermission } = {}) => {
  if (endpoint?.kind === "stdio" && endpoint.client?.request) {
    try {
      return await endpoint.client.request(message.method, message.params || {}, { signal, timeoutMs, onUpdate, onProtocolEvent, onPermission });
    } catch (error) {
      const authFailure = acpAuthFailure({ error: { message: error?.message, code: error?.code, data: error?.data } });
      if (authFailure) throw authFailure;
      throw error;
    }
  }
  const headers = {
    ...ACP_HEADERS,
    "acp-connection-id": credentials.connectionId,
    ...(credentials.sessionToken ? { "acp-session-token": credentials.sessionToken } : {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  const answerPermission = async (event) => {
    if (event?.method !== "session/request_permission" || event.id == null) return false;
    const result = onPermission ? await onPermission(event.params || {}) : { outcome: { outcome: "cancelled" } };
    const reply = await fetch(endpoint, { method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: event.id, result }), signal: controller.signal });
    if (!reply.ok) throw Object.assign(new Error(`WorkBuddy 工具权限回执发送失败（${reply.status}）`), { code: "WORKBUDDY_PERMISSION_REPLY_FAILED" });
    await reply.body?.cancel().catch(() => {});
    return true;
  };
  try {
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(message), signal: controller.signal });
    if (!response.ok) {
      const body = await response.text();
      const message = `WorkBuddy ACP 请求失败（${response.status}）：${body.slice(-400)}`;
      if ([401, 403].includes(Number(response.status))) throw workBuddyChannelAuthError(response.status);
      throw Object.assign(new Error(message), { code: "WORKBUDDY_ACP_REQUEST_FAILED", statusCode: Number(response.status) || 0 });
    }
    const isSse = response.headers.get("content-type")?.includes("text/event-stream");
    if (!isSse || !response.body?.getReader) {
      const body = await response.text();
      const messages = isSse ? parseSse(body) : [JSON.parse(body)];
      for (const event of messages) onProtocolEvent?.(event);
      for (const event of messages) await answerPermission(event);
      for (const event of messages) if (event?.method === "session/update") onUpdate?.(event.params || {});
      const result = messages.find((event) => !event?.method && String(event?.id) === String(message.id))
        || messages.findLast((event) => event?.method === "session/update" && promptUpdateIsTerminal(event.params)) || {};
      const authFailure = acpAuthFailure(result);
      if (authFailure) throw authFailure;
      return result;
    }
    // WorkBuddy keeps the ACP event stream open after emitting the JSON-RPC
    // response. Waiting for response.text() therefore turns a completed
    // prompt into a timeout. Consume frames incrementally and resolve as soon
    // as this request's response id arrives; session updates remain live.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const parseFrame = (frame) => {
      const data = frame.split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) return null;
      try { return JSON.parse(data); } catch { return null; }
    };
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      let boundary = buffer.search(/\r?\n\r?\n/u);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/u, "");
        const event = parseFrame(frame);
        if (event) onProtocolEvent?.(event);
        if (await answerPermission(event)) { boundary = buffer.search(/\r?\n\r?\n/u); continue; }
        if (event?.method === "session/update") onUpdate?.(event.params || {});
        if (event && !event.method && String(event.id ?? "") === String(message.id ?? "")) {
          await reader.cancel().catch(() => {});
          const authFailure = acpAuthFailure(event);
          if (authFailure) throw authFailure;
          return event;
        }
        if (message.method === "session/prompt" && event?.method === "session/update" && promptUpdateIsTerminal(event.params)) {
          await reader.cancel().catch(() => {});
          return { jsonrpc: "2.0", id: message.id, result: { status: "completed" }, params: event.params };
        }
        boundary = buffer.search(/\r?\n\r?\n/u);
      }
      if (chunk.done) {
        const event = parseFrame(buffer) || (() => { try { return JSON.parse(buffer); } catch { return null; } })();
        if (event) onProtocolEvent?.(event);
        await answerPermission(event);
        if (event?.method === "session/update") onUpdate?.(event.params || {});
        if (message.method === "session/prompt" && event?.method === "session/update" && promptUpdateIsTerminal(event.params)) {
          return { jsonrpc: "2.0", id: message.id, result: { status: "completed" }, params: event.params };
        }
        const result = event || {};
        const authFailure = acpAuthFailure(result);
        if (authFailure) throw authFailure;
        return result;
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", abort);
  }
};

const ACP_TEXT_UPDATE_KINDS = new Set([
  "agent_message_chunk",
  "agent_message",
  "assistant_message",
  "assistant",
  "message",
  "text",
  "text_delta",
  "final_message",
  "final",
]);

export const updateText = (params = {}) => {
  const update = params?.update && typeof params.update === "object" ? params.update : params;
  const kind = clean(update?.sessionUpdate || update?.type || update?.kind || "").toLocaleLowerCase();
  if (!ACP_TEXT_UPDATE_KINDS.has(kind)) return "";
  const content = update.content ?? update.message ?? update.text ?? update.delta ?? update.output;
  if (typeof content === "string") return content;
  return terminalAcpText(content);
};

// ACP messages are not one continuous answer: a model can explain its next
// tool call, call the tool, then send the actual answer with a new messageId.
// Keep every chunk of that final message (including intentional repetitions),
// not the concatenation of all assistant messages in the turn.
export const createWorkBuddyTextCollector = ({ sessionId = "" } = {}) => {
  const messages = new Map();
  let latestKey = "";
  let anonymousEpoch = 0;
  let afterTool = false;
  return {
    push(params = {}) {
      if (sessionId && params.sessionId && params.sessionId !== sessionId) return;
      const update = params.update || params;
      const kind = clean(update.sessionUpdate || update.type || update.kind).toLowerCase();
      if (/^tool(?:_|$)/u.test(kind)) { afterTool = true; return; }
      const value = updateText(params);
      if (!value) return;
      const id = clean(update.messageId || update._meta?.["codebuddy.ai/messageId"]
        || update._meta?.["codebuddy.ai/llmMessageId"] || update.message?.id);
      if (afterTool) { anonymousEpoch += 1; afterTool = false; }
      const key = id || `anonymous:${anonymousEpoch}`;
      const delta = ["agent_message_chunk", "text_delta"].includes(kind);
      if (!messages.has(key)) latestKey = key;
      messages.set(key, delta ? (messages.get(key) || "") + value : value);
    },
    finalText(result = {}) {
      return (updateText(result.params || {}) || terminalAcpText(result)
        || messages.get(latestKey) || "").trim();
    },
    get textCharacters() { return (messages.get(latestKey) || "").length; },
  };
};

// ACP implementations differ in where the terminal assistant text is
// placed.  Streaming builds use `update.content.text`, while some desktop
// builds return the completed message under `result.content`, `result.output`
// or a nested `message`.  Keep this extractor deliberately text-only so
// protocol/status/error objects never become user-visible output.
export const terminalAcpText = (value, depth = 0, seen = new Set()) => {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => terminalAcpText(item, depth + 1, seen)).filter(Boolean).join("");
  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  for (const key of ["text", "output_text", "content", "output", "message", "answer", "final", "result", "params"]) {
    const candidate = terminalAcpText(value[key], depth + 1, seen);
    if (candidate) return candidate;
  }
  return "";
};

// Some WorkBuddy builds keep the ACP SSE connection open and omit the JSON-RPC
// response id for `session/prompt`. They do, however, emit a terminal
// session/update frame. Treat that frame as the prompt response; otherwise a
// completed answer sits in an open stream until the six-minute watchdog fires.
export const promptUpdateIsTerminal = (params = {}) => {
  const update = params?.update && typeof params.update === "object" ? params.update : params;
  const kind = clean(update.sessionUpdate || update.type || update.kind).toLocaleLowerCase();
  // A tool call can finish while the model is still composing its answer.
  // Treating its status=completed as the prompt terminal cancels the stream
  // immediately after a successful read and loses the final assistant text.
  if (/^(?:tool(?:_|\b)|agent_thought|agent_message_chunk|plan|usage|available_commands|current_mode)/u.test(kind)) return false;
  const status = clean(update?.status || update?.state || update?.sessionUpdate || update?.type).toLocaleLowerCase();
  if (update?.completed === true || update?.finished === true || update?.done === true) return true;
  return /^(?:completed?|done|finished?|stopped|cancelled|canceled)$/u.test(status)
    || /(?:turn|prompt|session|agent)[ _-]*(?:complete|completed|done|end|ended|finish|finished)$/u.test(status);
};

const parseAcpErrorPayload = (value, depth = 0) => {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") {
    const source = value.trim();
    if (!source) return null;
    try { return parseAcpErrorPayload(JSON.parse(source), depth + 1); } catch {}
    return { message: source };
  }
  if (typeof value !== "object") return null;
  const message = clean(value.message || value.errorMessage || value.details);
  const code = clean(value.code || value.category || value.errorCode);
  const nested = value.error || value.data || value.details;
  const child = nested && typeof nested === "object" ? parseAcpErrorPayload(nested, depth + 1) : null;
  return { ...(child || {}), ...(message ? { message } : {}), ...(code ? { code } : {}) };
};

export const acpAuthFailure = (promptResult = {}) => {
  const candidates = [
    promptResult?.error,
    promptResult?.result?.error,
    promptResult?.result?.errorMessage,
    promptResult?.result?._meta?.["codebuddy.ai/errorMessage"],
    promptResult?._meta?.["codebuddy.ai/errorMessage"],
    promptResult?.params?.error,
  ];
  for (const candidate of candidates) {
    const parsed = parseAcpErrorPayload(candidate);
    const text = clean([parsed?.code, parsed?.message, typeof candidate === "string" ? candidate : ""].filter(Boolean).join(" "));
    if (/(?:authentication required|not authenticated|please use \/login|登录|未登录|auth_required)/iu.test(text)) {
      return workBuddyAuthError(`WorkBuddy 桌面会话未登录：${text.slice(0, 300)}`);
    }
  }
  return null;
};

export const connectAcp = async (endpoint, options = {}) => {
  if (endpoint?.kind === "stdio") return { kind: "stdio" };
  const connectEndpoint = `${String(endpoint).replace(/\/$/u, "")}/connect`;
  const response = await fetch(connectEndpoint, { method: "POST", headers: { "x-codebuddy-request": "1" }, signal: options.signal });
  if (!response.ok) {
    if ([401, 403].includes(Number(response.status))) throw workBuddyChannelAuthError(response.status);
    throw Object.assign(new Error(`WorkBuddy ACP 连接失败（${response.status}）`), { code: "WORKBUDDY_ACP_CONNECT_FAILED", statusCode: Number(response.status) || 0 });
  }
  const credentials = await response.json();
  if (!credentials?.connectionId) throw new Error("WorkBuddy ACP 未返回会话凭据");
  return credentials;
};

const closeAcp = async (endpoint, credentials, { sidecar = null, sessionId = "" } = {}) => {
  if (endpoint?.kind === "stdio") {
    await endpoint.client?.close?.();
    return;
  }
  if (credentials?.connectionId) {
    await fetch(String(endpoint), {
      method: "DELETE",
      signal: AbortSignal.timeout(5_000),
      headers: {
        ...ACP_HEADERS,
        "acp-connection-id": credentials.connectionId,
        ...(credentials.sessionToken ? { "acp-session-token": credentials.sessionToken } : {}),
      },
    }).catch(() => {});
  }
  if (sidecar?.controlPipe && clean(sessionId)) {
    await controlRequest(sidecar.controlPipe, {
      jsonrpc: "2.0",
      id: 10,
      method: "session.kill",
      params: { sessionId: clean(sessionId) },
    }).catch(() => {});
  }
};

const sessionModels = (result = {}) => (Array.isArray(result?.models?.availableModels) ? result.models.availableModels : [])
  .map((item) => ({ id: clean(item?.modelId || item?.id), name: clean(item?.name || item?.modelId || item?.id) }))
  .filter((item) => item.id);

const normalizedModelLabel = (value = "") => clean(value).toLocaleLowerCase().replace(/[\s._-]+/gu, "");

/**
 * Resolve a persisted WorkBuddy model against the current desktop catalogue.
 * WorkBuddy has changed the stable ID behind the user-facing Hy3 label more
 * than once (the old Shensi profile used `hy3`, while the current desktop
 * catalogue exposes `hy3-c`/`hy3-x`). Never turn that catalogue drift into an
 * authentication error: use an exact ID first, then a label/legacy alias,
 * and only report unavailable when there is no safe match.
 */
export const resolveWorkBuddyModelId = (requested = "", available = [], labels = {}) => {
  const value = clean(requested);
  const models = (Array.isArray(available) ? available : [])
    .map((item) => typeof item === "string" ? { id: clean(item), name: clean(labels?.[item]) } : { id: clean(item?.id || item?.modelId), name: clean(item?.name || labels?.[item?.id || item?.modelId]) })
    .filter((item) => item.id);
  if (!value) return "";
  const exact = models.find((item) => item.id === value);
  if (exact) return exact.id;
  const normalized = normalizedModelLabel(value);
  const legacyAliases = new Map([
    ["hy3", "hy3"],
    ["hy3c", "hy3"],
    ["hy3x", "hy3"],
  ]);
  const labelNeedle = legacyAliases.get(normalized) || normalized;
  // The desktop catalogue disambiguates duplicate labels with a credit suffix
  // (for example `Hy3（积分倍率 x0.00）`).  Match the stable model id first,
  // then the visible label prefix; otherwise a persisted legacy `hy3` value
  // is incorrectly reported as unavailable even though `hy3-c` is runnable.
  const idMatch = models
    .filter((item) => normalizedModelLabel(item.id).startsWith(labelNeedle))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))[0];
  if (idMatch) return idMatch.id;
  const labelMatch = models.find((item) => normalizedModelLabel(item.name).startsWith(labelNeedle));
  if (labelMatch) return labelMatch.id;
  return "";
};

export const openAcpTaskSession = async ({ sidecar, cwd, nativeHost, model = "", environment = process.env, signal = null, timeoutMs = 120_000,
  createSession = createHeadlessSession, connect = connectAcp, post = acpPost, close = closeAcp } = {}) => {
  // Never reuse an arbitrary sidecar session.  It may have been created by an
  // older Shensi build (or by WorkBuddy itself) with a stale model catalogue
  // and a different environment.  A fresh, explicitly owned session keeps the
  // account/model context deterministic; it is killed in closeAcp below.
  let session = null;
  let credentials = null;
  const prepare = async () => {
    signal?.throwIfAborted();
    if (!session) session = await createSession({ sidecar, cwd, nativeHost, model, environment, timeoutMs });
    credentials = await connect(session.acpEndpoint, { signal });
    const initialized = await post(session.acpEndpoint, credentials, {
      jsonrpc: "2.0", id: 5, method: "initialize",
      params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "shensi", version: "1.0" } },
    }, { signal, timeoutMs });
    if (initialized?.error) throw Object.assign(new Error(initialized.error.message || "WorkBuddy ACP 初始化失败"), { code: "WORKBUDDY_ACP_INITIALIZE_FAILED" });
    signal?.throwIfAborted();
    const created = await post(session.acpEndpoint, credentials, {
      jsonrpc: "2.0", id: 6, method: "session/new",
      params: { cwd: resolve(cwd), mcpServers: toMcpServers(nativeHost) },
    }, { signal, timeoutMs });
    if (created?.error) throw Object.assign(new Error(created.error.message || "WorkBuddy ACP 任务会话创建失败"), { code: "WORKBUDDY_ACP_SESSION_FAILED" });
    const result = created?.result || {};
    if (!clean(result.sessionId)) throw Object.assign(new Error("WorkBuddy ACP 未创建任务会话"), { code: "WORKBUDDY_ACP_SESSION_FAILED" });
    return { session, credentials, result };
  };
  try {
    return await prepare();
  } catch (firstError) {
    // A desktop sidecar may keep a stale ACP child after a restart/update.
    // Recreate exactly once, bounded to the lifecycle handshake; never retry
    // the provider prompt itself and never create a second user task.
    await close(session?.acpEndpoint, credentials, { sidecar, sessionId: session?.sessionId }).catch(() => {});
    signal?.throwIfAborted();
    const restartable = sidecar?.controlPipe && ["WORKBUDDY_ACP_CONNECT_FAILED", "WORKBUDDY_ACP_SESSION_FAILED", "WORKBUDDY_ACP_TIMEOUT", "ECONNREFUSED", "ECONNRESET"].includes(firstError.code || firstError.cause?.code);
    if (firstError.name === "AbortError" || !restartable) throw firstError;
    session = null;
    credentials = null;
    try {
      return await prepare();
    } catch (secondError) {
      await close(session?.acpEndpoint, credentials, { sidecar, sessionId: session?.sessionId }).catch(() => {});
      secondError.cause = firstError;
      throw secondError;
    }
  }
};

// Handshake only: never catch/replay session/prompt or a broker model request.
export const prepareWorkBuddyDesktopSession = async (options, { openSession = openAcpTaskSession, discoverRequest = discoverSidecar } = {}) => {
  try { return await openSession(options); } catch (error) {
    const { sidecar, environment, signal } = options;
    const missingBootstrap = /^CBC credential bootstrap (?:channel closed early|transport timed out)$/u.test(clean(error.message));
    const localChannelRejected = error.code === 'WORKBUDDY_ACP_CHANNEL_AUTH_REQUIRED' && error.authScope === 'local_acp_channel';
    // A rejected local ACP handshake is not an upstream account rejection.
    // The same desktop's request broker still verifies its own ticket/proofs;
    // never transplant credentials, bypass authentication, or replay a prompt.
    if (signal?.aborted || error.name === 'AbortError' || !(missingBootstrap || localChannelRejected) || !sidecar?.controlPipe || !(sidecar.desktopPid > 0) || !sidecar.executable
      || !localChannelRejected && /AUTH_REQUIRED/u.test(String(error.code || ''))) throw error;
    const requestSidecar = await discoverRequest({ environment, desktopRequestOnly: true, desktopPid: sidecar.desktopPid });
    if (!requestSidecar?.desktopRequest || requestSidecar.desktopPid !== sidecar.desktopPid
      || resolve(requestSidecar.executable || '').toLowerCase() !== resolve(sidecar.executable).toLowerCase()) throw error;
    signal?.throwIfAborted();
    return { requestSidecar, handshakeFailure: localChannelRejected ? 'local_acp_channel_rejected' : 'credential_bootstrap_unavailable' };
  }
};

export const inspectWorkBuddyDesktopBridge = async ({ cwd = process.cwd(), nativeHost = null, environment = process.env, timeoutMs = 90_000 } = {}) => {
  const sidecar = await waitForSidecar({ environment, timeoutMs: Math.min(timeoutMs, BRIDGE_READINESS_WINDOW_MS) });
  if (!sidecar) return { connected: false, authenticated: null, state: "bridge_unavailable", models: [], message: "WorkBuddy 桌面端未提供可用 ACP 桥接；桌面端登录状态未被判定为失效" };
  let session;
  let credentials;
  try {
    const opened = sidecar.desktopRequest ? { requestSidecar: sidecar }
      : await prepareWorkBuddyDesktopSession({ sidecar, cwd, nativeHost, environment, timeoutMs });
    if (opened.requestSidecar) {
      const catalog = disambiguateWorkBuddyModelNames(await resolvedProductModels(environment));
      return { connected: true, authenticated: null, inferenceReady: true, state: "bridge_ready", ready: false, models: catalog.map((item) => item.id),
        modelLabels: Object.fromEntries(catalog.map((item) => [item.id, item.name])), catalogSource: "workbuddy_desktop_request",
        ...(opened.handshakeFailure ? { handshakeFailure: opened.handshakeFailure } : {}),
        message: `WorkBuddy 桌面请求通道已连接，已读取 ${catalog.length} 个模型；账号可用性由真实请求核验` };
    }
    ({ session, credentials } = opened);
    const result = opened.result || {};
    const sessionCatalog = sessionModels(result);
    const resolvedCatalog = await resolvedProductModels(environment);
    const catalog = disambiguateWorkBuddyModelNames(resolvedCatalog.length ? resolvedCatalog : sessionCatalog, resolvedCatalog);
    return {
      connected: true,
      authenticated: true,
      state: "ready",
      ready: true,
      models: catalog.map((item) => item.id),
      modelLabels: Object.fromEntries(catalog.map((item) => [item.id, item.name])),
      catalogSource: "workbuddy_acp_session",
      session,
      message: `WorkBuddy 桌面会话有效，已读取 ${catalog.length} 个真实模型`,
    };
  } catch (error) {
    const authRequired = error?.code === "WORKBUDDY_AUTH_REQUIRED";
    return {
      connected: false,
      authenticated: authRequired ? false : null,
      state: authRequired ? "auth_required" : "bridge_error",
      models: [],
      message: authRequired
        ? "WorkBuddy 桌面会话明确返回未登录，请在 WorkBuddy 中完成登录后重新检查"
        : clean(error?.message || error).slice(0, 500),
      errorCode: authRequired ? "WORKBUDDY_AUTH_REQUIRED" : error?.code === 'WORKBUDDY_ACP_CHANNEL_AUTH_REQUIRED' ? error.code : "WORKBUDDY_DESKTOP_BRIDGE_ERROR",
    };
  } finally {
    await closeAcp(session?.acpEndpoint, credentials, { sidecar, sessionId: session?.sessionId });
  }
};

export const runWorkBuddyDesktopBridge = async ({ prompt, model = "", cwd = process.cwd(), nativeHost = null, environment = process.env, signal = null, timeoutMs = DEFAULT_TIMEOUT_MS, onEvent, onProtocolEvent, reasoningEffort = '', maxOutputTokens = 0 } = {}) => {
  const sidecar = await waitForSidecar({ environment, signal, timeoutMs: Math.min(timeoutMs, BRIDGE_READINESS_WINDOW_MS) });
  if (!sidecar) {
    const error = new Error("WorkBuddy 桌面端已登录，但神思未发现可用 ACP 桥接；请保持 WorkBuddy 客户端运行后重试");
    error.code = "WORKBUDDY_DESKTOP_BRIDGE_UNAVAILABLE";
    throw error;
  }
  if (sidecar.desktopRequest) return runWorkBuddyDesktopRequest({ sidecar, prompt, model, nativeHost, signal, timeoutMs, onEvent, environment, reasoningEffort, maxOutputTokens });
  let session;
  let credentials;
  try {
    const opened = await prepareWorkBuddyDesktopSession({ sidecar, cwd, nativeHost, model, environment, signal, timeoutMs: Math.min(timeoutMs, 120_000) });
    if (opened.requestSidecar) return await runWorkBuddyDesktopRequest({ sidecar: opened.requestSidecar, prompt, model, nativeHost, signal, timeoutMs, onEvent, environment, reasoningEffort, maxOutputTokens });
    ({ session, credentials } = opened);
    const sessionResult = opened.result || {};
    const sessionId = clean(sessionResult.sessionId);
    const sessionCatalog = sessionModels(sessionResult);
    const resolvedCatalog = await resolvedProductModels(environment);
    // The desktop session may expose the special `auto` selector while the
    // resolved product catalogue exposes the newer full model set. Keep that
    // selector for login probes, but use the resolved catalogue for real
    // model IDs so stale nine-model sessions cannot hide current models.
    const available = disambiguateWorkBuddyModelNames(resolvedCatalog.length > sessionCatalog.length
      ? [...resolvedCatalog, ...sessionCatalog.filter((item) => item.id === "auto")]
      : sessionCatalog, resolvedCatalog);
    const selectedModel = /^auto$/iu.test(clean(model)) ? "" : resolveWorkBuddyModelId(model, available);
    const effectiveModel = clean(model) && !/^auto$/iu.test(clean(model)) ? (selectedModel || "") : "";
    if (clean(model) && !/^auto$/iu.test(clean(model)) && !effectiveModel && available.length) {
      const error = new Error(`WorkBuddy 当前真实目录没有模型“${clean(model)}”；可选模型：${available.map((item) => item.id).join("、")}`);
      error.code = "WORKBUDDY_MODEL_UNAVAILABLE";
      throw error;
    }
    if (effectiveModel) {
      const switched = await acpPost(session.acpEndpoint, credentials, {
        jsonrpc: "2.0",
        id: 8,
        method: "session/set_model",
        params: { sessionId, modelId: effectiveModel },
      }, { signal, timeoutMs: Math.min(timeoutMs, 120_000) });
      if (switched?.error) throw Object.assign(new Error(switched.error.message || "WorkBuddy 模型切换失败"), { code: "WORKBUDDY_MODEL_SWITCH_FAILED" });
    }
    const collected = createWorkBuddyTextCollector({ sessionId });
    const frameSummary = { updateCount: 0, textCharacters: 0, lastUpdateKind: "", lastUpdateStatus: "" };
    const update = (params) => {
      const frame = params?.update || params || {};
      frameSummary.updateCount += 1;
      frameSummary.lastUpdateKind = clean(frame.sessionUpdate || frame.type || frame.kind);
      frameSummary.lastUpdateStatus = clean(frame.status || frame.state);
      collected.push(params);
      frameSummary.textCharacters = collected.textCharacters;
    };
    const promptResult = await acpPost(session.acpEndpoint, credentials, { jsonrpc: "2.0", id: 7, method: "session/prompt", params: { sessionId, prompt: [{ type: "text", text: String(prompt || "") }] } }, { signal, timeoutMs, onUpdate: update, onProtocolEvent, onPermission: (params) => workBuddyToolPermission(params, nativeHost) });
    const authFailure = acpAuthFailure(promptResult);
    if (authFailure) throw authFailure;
    // Do not use `result || params` here: a valid JSON-RPC result often only
    // carries `{ status: "completed" }`, while the actual assistant message
    // remains in params or in the last session/update frame.
    const finalText = collected.finalText(promptResult);
    if (!finalText) throw Object.assign(new Error("WorkBuddy ACP 已结束，但没有返回可用文本"), {
      code: "WORKBUDDY_ACP_EMPTY_TEXT", diagnostics: { ...frameSummary, resultKeys: Object.keys(promptResult?.result || {}), stopReason: clean(promptResult?.result?.stopReason) },
    });
    // Earlier messages may be process narration. Emit only once the terminal
    // response identifies the final answer; never flash that narration in UI.
    onEvent?.({ type: "text", phase: "text_delta", text: finalText, part: { type: "text", id: "workbuddy-acp", text: finalText } });
    return { text: finalText.trim(), sessionId, actualProvider: "WorkBuddy", actualModel: effectiveModel || "auto", executionRuntime: "workbuddy_desktop_acp", permissionMode: "shensi_only" };
  } finally {
    await closeAcp(session?.acpEndpoint, credentials, { sidecar, sessionId: session?.sessionId });
  }
};
