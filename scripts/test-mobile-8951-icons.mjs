import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {mobileShellIcon} from '../apps/mobile/src/shell-icons.js';
const source=await readFile('docs/previews/creative-suite-20261027/mobile-v3.js','utf8');
// Execute only the fixed public icon declarations, never the demo application.
const declarations=source.slice(source.indexOf('const icons='),source.indexOf('const btn='));
const reference=vm.runInNewContext(declarations+'\nicon',{h:value=>value});
for(const key of ['panel','search','new','tabs','doc','edit','read','more','settings','chat','cloud','folder','download','trash','lock','unlock','upload','expand','collapse','star','arrow','down','right','check','tick','history','clock','link','outline','sparkles','user','language','sun','moon','monitor','blocks','puzzle','sliders','refresh','logout','folderOpen','board','headphones','close'])assert.equal(mobileShellIcon(key),reference(key),key);
console.log('PASS 44 个界面图标与 8951 MOBILE / 07 的 SVG 几何逐项一致，无加载预览状态或示例资料');
