// Account identity, compute billing and file-storage permissions are independent.
export function cloudSyncStatus(result) {
 if(typeof result?.syncEnabled!=='boolean'||typeof result.storageReady!=='boolean'||typeof result.eligible!=='boolean'||!result.permissions||!Number.isSafeInteger(result.quotaBytes)||result.quotaBytes<0)throw Object.assign(Error('云空间状态响应无效'),{code:'CLOUD_SYNC_INVALID_RESPONSE'});
 const available=result.controlPlaneReady===true&&result.storageReady&&result.eligible&&result.syncEnabled&&result.permissions.upload===true;
 const reasons={space_required:'已获得云空间资格，请先分配个人空间',membership_required:'需要有效的云存储会员权益',personal_trial_not_allowed:'此账号尚未获准个人试用',storage_unavailable:'官方存储暂不可用',capacity_exhausted:'官方存储可分配容量不足',transfer_adapter_pending:'官方文件传输服务尚未就绪'};
 return {state:available?'available':Object.hasOwn(reasons,result.reason)?result.reason:'unavailable',message:available?'官方云空间已连接':reasons[result.reason]||'云同步暂不可用',checkedAt:new Date().toISOString(),quotaBytes:result.quotaBytes,personalTrial:result.personalTrial===true};
}
