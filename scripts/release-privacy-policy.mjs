// Shared desktop/mobile distribution boundary. Do not read personal profiles.
export const PRIVATE_SKILL_INPUTS=['resources/legacy-skills','packages/official/work-skills','packages/official/work-skills.json','packages/official/work-skill-complement.mjs','packages/official/legacy/server/bundled-custom-skills.mjs'];
export function privateSkillInput(name){name=name.replaceAll('\\','/').replace(/^\.\//,'').toLowerCase();return PRIVATE_SKILL_INPUTS.some(p=>name===p||name.startsWith(p+'/')||name.endsWith('/'+p)||name.includes('/'+p+'/'));}
export function assertPublicText(text,name){
 if(/\bsk-[A-Za-z0-9_-]{35,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}/.test(text))throw Error('发行内容疑似包含凭据，已阻止打包：'+name);
}
export function assertPublicInput(name){
 const normalized=name.replaceAll('\\','/');
 if(privateSkillInput(normalized)||/(?:^|\/)(?:user-data|desktop-profile|machine|知识库|笔记|credentials|\.codex|\.agents)(?:\/|$)/i.test(normalized)||/(?:^|\/)(?:\.env(?:\.[^/]+)?|auth\.json|cookies|runtime-config\.json)$|\.(?:sql|sqlite3?|db|key|pfx|p12)(?:\.(?:bak|gz|zip))?$/i.test(normalized))throw Error('发行包拒绝个人资料输入：'+name);
}
