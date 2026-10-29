// The approved MOBILE / 07 interaction preview packaged as a phone-sized app.
// This entry deliberately uses isolated preview data from mobile-v3.js; it
// never reads the desktop library, account vault, cookies, or provider keys.
import {createMobileV3} from '../../../docs/previews/creative-suite-20261027/mobile-v3.js';

const root=document.querySelector('#app');
function renderPhone(){
  root.innerHTML=preview.page();
  const logo=()=>{const img=document.createElement('img');img.src='assets/shensi-logo.png';img.alt='神思笔记';img.className='mobile-brand-logo';return img;};
  const title=root.querySelector('.phone-head>strong');
  if(title){const text=document.createElement('span');text.textContent=title.textContent;title.replaceChildren(logo(),text);title.classList.add('mobile-brand-title');}
  const settings=root.querySelector('.m7-settings>h2');
  if(settings){settings.prepend(logo());settings.classList.add('mobile-brand-title');}
  root.querySelectorAll('.m6-account-avatar').forEach(node=>node.replaceChildren(logo()));
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
