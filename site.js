'use strict';
const scenarios = {
  fix: {prompt:'Find and fix the failing auth test.',thought:'I’ll trace the failure, check the implementation, and make a focused fix.',read:'src/auth.ts · test/auth.test.ts',edit:'Handle an expired session token',remove:'− return session.user;',add:'+ return session?.user ?? null;',result:'Fix applied. Auth tests passing.'},
  build: {prompt:'Add a search filter to the projects page.',thought:'I’ll check the list component, add a search input, and test the filter behavior.',read:'src/projects.tsx · test/projects.test.ts',edit:'Filter projects by the search query',remove:'− const visible = projects;',add:'+ const visible = projects.filter(matchesQuery);',result:'Search added. Filter tests passing.'},
  explore: {prompt:'Explain how a request moves through this app.',thought:'I’ll follow the entry point through routing, authentication, and the response.',read:'src/server.ts · src/router.ts · src/auth.ts',edit:'Trace the request flow; no edits needed',remove:'→ server.ts → router.ts → auth.ts',add:'→ authenticate → route handler → response',result:'Request flow mapped. No files changed.'}
};
const toast = document.getElementById('toast');
let toastTimer;
function notify(message) { clearTimeout(toastTimer); toast.textContent=message; toast.classList.add('visible'); toastTimer=setTimeout(()=>toast.classList.remove('visible'),3000); }
async function copyText(text) {
  if(navigator.clipboard && window.isSecureContext) { try { await navigator.clipboard.writeText(text); return true; } catch {} }
  const field=document.createElement('textarea');field.value=text;field.setAttribute('readonly','');field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();
  let copied=false;try { copied=document.execCommand('copy'); } catch {} field.remove();return copied;
}
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{
  const copied=await copyText(button.dataset.copy);
  notify(copied?'Command copied. Paste it into your terminal.':'Couldn’t copy automatically. Select and copy the command.');
}));
document.querySelectorAll('[data-demo]').forEach(button=>button.addEventListener('click',()=>{
  const scene=scenarios[button.dataset.demo];
  for(const key of ['prompt','thought','read','edit','result'])document.getElementById('demo-'+key).textContent=scene[key];
  document.getElementById('diff-remove').textContent=scene.remove;document.getElementById('diff-add').textContent=scene.add;
  document.querySelectorAll('[data-demo]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});
}));
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  const filter=button.dataset.filter;let count=0;
  document.querySelectorAll('.model-card').forEach(card=>{const show=filter==='all'||card.dataset.category.split(' ').includes(filter);card.hidden=!show;if(show)count++;});
  document.querySelectorAll('[data-filter]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});
  document.getElementById('model-count').textContent=count+' models '+(filter==='all'?'available in the catalog':'in this selection');
}));
const menu=document.querySelector('.menu-toggle');const navigation=document.getElementById('navigation');
function closeMenu(){menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open navigation');navigation.classList.remove('open');}
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');navigation.classList.toggle('open',open);});
navigation.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.getAttribute('aria-expanded')==='true'){closeMenu();menu.focus();}});
document.addEventListener('click',event=>{if(!event.target.closest('.nav'))closeMenu();});
