import {createAgentToolOutputVerifier} from './agent-tool-output.mjs';
// Native Codex now owns namespaces such as skills.read. A translated provider
// response must not be dispatched to that native tool instead of Shensi's
// document/Skill host. Give all dynamic tools a private wire namespace and
// translate only at the host boundary; business tool names remain unchanged.
export const codexWorkspaceTools = (runtime) => {
  if (!runtime) return { runtime: null, instructions: "", originalEvent: event => event };
  const names = new Map((runtime.dynamicTools || []).map(ns => [`shensi_host_${ns.name}`, ns.name]));
  const dynamicTools = (runtime.dynamicTools || []).map(ns => ({ ...ns, name: `shensi_host_${ns.name}` }));
  const verifier=createAgentToolOutputVerifier();
  return {
    runtime: {
      ...runtime, dynamicTools,
      registerToolCall: call=>verifier.registerCall(call),
      verifyToolOutput: (call,output)=>verifier.verify(call,output),
      invoke: async ({ namespace, ...args }) => {
        if (!names.has(namespace)) throw new Error("未登记的神思工具命名空间");
        // Bind the receipt to the original request, before a host tool can add
        // defaults or otherwise normalize its argument object in place.
        const call=structuredClone({namespace,...args});
        const rejected=verifier.rejectedResult(call);
        if(rejected)return rejected;
        // Exceptions have no reliable completion receipt: a write may already
        // have happened. Keep the failure verifiable, never auto-repeat it.
        let result;
        try{result=await runtime.invoke({ ...args, namespace: names.get(namespace) });}
        catch(error){
          if(error?.safeToFallback===false||error?.code==='AGENT_TOOL_OUTPUT_TOO_LARGE'||error?.name==='AbortError'||error?.code==='ABORTED')throw error;
          result={success:false,contentItems:[{type:'inputText',text:JSON.stringify({code:'AGENT_HOST_TOOL_ERROR',execution:'unknown',error:'宿主工具发生异常，未取得可靠的完成回执。请先读取当前结果确认是否已经写入；不要自动重复写入或提交生成。'})}]};
        }
        return verifier.relay(call,result);
      },
    },
    instructions: `本轮神思工具使用独立命名空间，避免和运行器内置工具重名。资料中的工具名称按以下对应关系调用：${[...names].map(([wire, original]) => `${original}.* → ${wire}.*`).join("；")}。工具含义、权限、参数保持不变，不使用同名的运行器内置工具替代。`,
    originalEvent: (event) => {
      if (typeof event?.name !== "string") return event;
      const [namespace, ...rest] = event.name.split(".");
      return names.has(namespace) ? { ...event, name: [names.get(namespace), ...rest].join(".") } : event;
    },
  };
};
