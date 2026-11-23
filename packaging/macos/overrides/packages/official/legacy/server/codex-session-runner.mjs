import { join } from "node:path";
import { createShensiCodexAgentRuntime } from "./shensi-codex-agent-runtime.mjs";
import { nativeCodexEnvironment, shensiCodexEnvironment } from "./codex-runtime-isolation.mjs";
import { resolveLocalCodexLaunch } from "../cli/codex-launch.mjs";
import { effectiveRuntimeContract } from "../effective-runtime-contract.js";
import { codexWorkspaceTools } from "./codex-workspace-tools.mjs";

const selectedCredentialSource = (settings = {}) => {
  if (!Array.isArray(settings?.textConnections) || !settings.textConnections.length) return settings?.credentialSource;
  // Whiteboard legacy projections do not flatten credentialSource. Resolve the
  // actual selected contract; a stale top-level source must not lend identity.
  const contract = effectiveRuntimeContract({ settings, surface: "agent" });
  return contract.ok && contract.engine === "codex" ? contract.credentialSource : "";
};

export const usesConfiguredCodexSession = ({ agentPreferred, engine, settings }) => (
  agentPreferred === true && engine === "codex" && selectedCredentialSource(settings) === "codex_session"
);

// Credential source and execution permission are independent. A user-selected
// current Codex session must not turn into an empty account just because the
// whiteboard has no interactive approval callback. Never copy credentials.
export const configuredCodexEnvironment = ({ settings, permissionMode, machineRoot, environment }) => (
  selectedCredentialSource(settings) === "codex_session" || permissionMode !== "shensi_only"
    ? nativeCodexEnvironment({ environment })
    : shensiCodexEnvironment({ machineRoot, environment })
);

export const runConfiguredCodexSession = async ({ appRoot, machineRoot, environment = process.env, runtimeFactory = createShensiCodexAgentRuntime, ...options }) => {
  const permissionMode = options.permissionContract?.mode || options.settings?.agentPermissionMode || "shensi_only";
  const runtimeRoot = join(machineRoot, "conversation-agent-v1", "external", options.shensiRuntime?.sessionId || options.requestId || "text-session");
  const childEnvironment = configuredCodexEnvironment({ settings: options.settings, permissionMode, machineRoot, environment });
  const runtime = runtimeFactory({ appRoot, machineRoot: runtimeRoot, environment: childEnvironment,
    isolateConfig: permissionMode === "shensi_only",
    launchResolver: () => resolveLocalCodexLaunch({ environment: { ...childEnvironment,
      ...(options.settings?.cliPath && options.settings.cliPath !== "codex" ? { SHENSI_CODEX_EXECUTABLE: options.settings.cliPath } : {}) } }),
  });
  // Use the same private tool namespace as the API runner. Native Codex owns
  // skills.read too; without translation it can read an unrelated local file.
  const workspace = codexWorkspaceTools(options.workspaceToolRuntime);
  try { return await runtime.runStage({ ...options,
    workspaceToolRuntime: workspace.runtime,
    system: [options.system, workspace.instructions].filter(Boolean).join("\n\n"),
    onToolEvent: event => options.onToolEvent?.(workspace.originalEvent(event)),
    settings: { ...options.settings, cliPath: options.settings?.cliPath || "codex" } }); }
  finally { await runtime.close(); }
};
