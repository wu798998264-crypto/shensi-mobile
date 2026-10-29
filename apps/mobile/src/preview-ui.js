// The approved MOBILE / 07 interaction preview packaged as a phone-sized app.
// This entry deliberately uses isolated preview data from mobile-v3.js; it
// never reads the desktop library, account vault, cookies, or provider keys.
import {createMobileV3} from '../../../docs/previews/creative-suite-20261027/mobile-v3.js';

const root=document.querySelector('#app');
function renderPhone(){
  root.innerHTML=preview.page();
  preview.mount(root);
}
let toastTimer;
const toast=message=>{
  const node=document.querySelector('#preview-toast');
  if(!node)return;
  node.textContent=String(message||'');
  node.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{node.hidden=true;},2200);
};
const preview=createMobileV3({
  render:renderPhone,
  toast,
});
renderPhone();
