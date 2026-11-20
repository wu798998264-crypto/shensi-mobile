// Official CLI 1.4.22 was checked on 2026-11-11. Neither 5.5 nor an
// unlimited submission option is declared. Never substitute a paid mode.
export const DREAMINA_55_UNAVAILABLE = '旧版即梦 CLI 不支持图片 5.5，请选择即梦画布配置中的 Seedream 5.5。';

export function dreaminaImageOptionError({provider,adapter,model,channel='image',imageCount=1,unlimitedGeneration=false}) {
  if (![true,false,'true','false',undefined].includes(unlimitedGeneration)) return {code:'IMAGE_UNLIMITED_INVALID',message:'无限生成选项无效，未提交任务。'};
  const unlimited = unlimitedGeneration===true || unlimitedGeneration==='true';
  if (unlimited) return {code:'UNLIMITED_GENERATION_REMOVED',message:'即梦 5.5 免费活动已结束，原请求未提交。'};
  if(channel==='image'&&provider==='即梦'&&adapter==='cli'&&![1,2,3,4].includes(Number(imageCount)))return {code:'IMAGE_COUNT_INVALID',message:'图片数量请选择 1 至 4 张；数量无效时不改为默认值，也不提交任务。'};
  if (channel==='image' && provider==='即梦' && adapter==='cli' && model==='5.5') return {code:'DREAMINA_55_NOT_SUPPORTED',message:DREAMINA_55_UNAVAILABLE};
  return null;
}
