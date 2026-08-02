import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;
app.use(cors());
app.use(express.json({limit:'100mb'}));

const ENV = { BUILDER_PASSWORD: process.env.BUILDER_PASSWORD||'', GITHUB_TOKEN: process.env.GITHUB_TOKEN||'', GITHUB_USERNAME: process.env.GITHUB_USERNAME||'' }
function cleanPass(s){return (s||'').toString().replace(/[\u200B-\u200D\uFEFF\u00A0\r\n\t]/g,'').trim()}
function getPASS(){return cleanPass(ENV.BUILDER_PASSWORD)}
function isAuth(req){const P=getPASS(); if(!P) return true; const c=req.headers.cookie||''; if(c.includes('builder_auth=')){try{const t=c.split('builder_auth=')[1].split(';')[0]; if(cleanPass(Buffer.from(t,'base64').toString())===P) return true}catch{}} if(req.query.key && cleanPass(req.query.key)===P) return true; return false}
function requireAuth(req,res,next){if(!getPASS()) return next(); if(isAuth(req)) return next(); if(req.path.startsWith('/api/') && req.path!=='/api/login') return res.status(401).json({error:'Unauthorized'}); return res.status(401).send(`<body style="background:#050507;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace"><div style="text-align:center"><h2>Private</h2><input id="pw" type="password" style="padding:10px;border-radius:10px"><br><button style="margin-top:10px;padding:10px 20px;background:#FF1493;border:none;border-radius:10px;color:#fff" onclick="fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})}).then(r=>r.json()).then(d=>{if(d.ok){document.cookie='builder_auth='+btoa(document.getElementById('pw').value)+'; Path=/; Max-Age=2592000';location.href='/?key='+document.getElementById('pw').value}})">Unlock</button></div></body>`) }
app.post('/api/login',(req,res)=>{const P=getPASS(), u=cleanPass(req.body?.password||''); if(!P) return res.json({ok:true}); if(u===P){const t=Buffer.from(P).toString('base64'); res.setHeader('Set-Cookie',`builder_auth=${t}; Path=/; Max-Age=2592000; SameSite=Lax`); return res.json({ok:true})} return res.status(401).json({ok:false})});

function parseRepoName(input){
 let name=(input||'').trim();
 const m=name.match(/github\.com\/[^\/]+\/([^\s\/\.]+)/i);
 if(m) name=m[1]; else if(name.includes('/')){const p=name.split('/').filter(Boolean); name=p[p.length-1].replace('.git','');}
 return name.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/--+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'my-app';
}

async function createRepoWithFiles(repoName, customFiles, customIconDataUrl, log){
 const token=ENV.GITHUB_TOKEN, username=ENV.GITHUB_USERNAME;
 log(`Creating ${repoName}...`);
 const createRes=await fetch('https://api.github.com/user/repos',{method:'POST',headers:{'Authorization':'token '+token,'Content-Type':'application/json'},body:JSON.stringify({name:repoName,private:false,auto_init:true})});
 const data=await createRes.json(); if(!createRes.ok) throw new Error(data.message);
 await new Promise(r=>setTimeout(r,4000));

 let iconBuffer=null;
 if(customIconDataUrl){ try{ iconBuffer=Buffer.from(customIconDataUrl.split(',')[1],'base64'); log(`Logo ${Math.round(iconBuffer.length/1024)}KB OK`);}catch{} }

 let allFiles={...customFiles};

 // --- SMART index.html HANDLER - ALL 3 MODES ---
 if(!allFiles['index.html']){
 log('No index.html in root, checking alternatives...');
 if(allFiles['public/index.html']){
 log('Found public/index.html -> copying to root (Mode A)');
 allFiles['index.html']=allFiles['public/index.html'];
 } else if(allFiles['src/index.html']){
 log('Found src/index.html -> copying to root (Mode A)');
 allFiles['index.html']=allFiles['src/index.html'];
 } else if(allFiles['dist/index.html']){
 log('Found dist/index.html -> copying to root (Mode A)');
 allFiles['index.html']=allFiles['dist/index.html'];
 } else {
 log('No entry found -> creating file explorer + factory error page (Mode B+C)');
 const fileList=Object.keys(customFiles).map(f=>`<a href="./${f}" class="file-link"><span class="icon">${f.endsWith('.html')?'🌐':f.endsWith('.js')?'📜':f.endsWith('.css')?'🎨':'📄'}</span> ${f}</a>`).join('');
 allFiles['index.html']=`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${repoName}</title>
<link rel="icon" type="image/png" href="./logo.png"><link rel="apple-touch-icon" href="./logo.png"><link rel="manifest" href="./manifest.json"><meta name="theme-color" content="#FF1493">
<script src="https://cdn.tailwindcss.com"><\/script></head>
<body class="bg-[#050507] text-white min-h-screen flex items-center justify-center p-6">
<div class="max-w-lg w-full text-center">
<div class="text-6xl mb-4">🏭</div>
<h1 class="text-3xl font-black bg-gradient-to-r from-[#FF1493] to-[#9D00FF] bg-clip-text text-transparent">V21 MASTER BUILDER</h1>
<p class="text-white/50 mt-2 text-sm">index.html not found, but your files are ready!</p>
<div class="mt-6 bg-white/5 border border-white/10 rounded-2xl p-4 text-left"><p class="text-xs text-white/40 mb-3">📁 YOUR FILES:</p><div class="grid gap-2">${fileList||'<span class="text-white/30">No custom files</span>'}</div></div>
<p class="text- text-white/20 mt-6">Tip: Add index.html or public/index.html next time</p>
</div>
<style>.file-link{display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(255,255,255,0.05);border-radius:10px;text-decoration:none;color:#fff;font-size:13px}.file-link:hover{background:rgba(255,20,147,0.2)}.icon{font-size:14px}</style>
</body></html>`;
 }
 }

 // Manifest with./logo.png - Splitter method
 if(!allFiles['manifest.json']){
 allFiles['manifest.json']=JSON.stringify({name:repoName, short_name:repoName.slice(0,12), start_url:"./index.html", display:"standalone", background_color:"#050507", theme_color:"#FF1493", icons:[{src:"./logo.png", sizes:"512x512", type:"image/png", purpose:"any maskable"}]},null,2);
 }
 if(!allFiles['sw.js']){
 allFiles['sw.js']=`const CACHE='v22-final'; const FILES=['./','./index.html','./manifest.json','./logo.png']; self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))); self.skipWaiting()}); self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))})`;
 }

 for(let [path, content] of Object.entries(allFiles)){
 const isLogo = path==='logo.png';
 let b64;
 if(isLogo && iconBuffer){ b64=iconBuffer.toString('base64'); }
 else if(isLogo &&!iconBuffer){
 try{ const res=await fetch(`https://via.placeholder.com/512/FF1493/FFFFFF?text=${repoName[0].toUpperCase()}`); const buf=Buffer.from(await res.arrayBuffer()); b64=buf.toString('base64'); }catch{ continue; }
 } else { b64=Buffer.from(content).toString('base64'); }
 let sha; try{const c=await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${path}`,{headers:{'Authorization':'token '+token}}); if(c.ok) sha=(await c.json()).sha}catch{}
 const up=await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${path}`,{method:'PUT',headers:{'Authorization':'token '+token,'Content-Type':'application/json'},body:JSON.stringify({message:`feat: ${path}`,content:b64,...(sha?{sha}:{})})});
 log(up.ok?`Uploaded ${path} OK`:`Failed ${path}`);
 }

 if(!allFiles['logo.png'] && iconBuffer){
 const b64=iconBuffer.toString('base64');
 await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/logo.png`,{method:'PUT',headers:{'Authorization':'token '+token,'Content-Type':'application/json'},body:JSON.stringify({message:'logo.png',content:b64})});
 log('Uploaded logo.png OK');
 }

 try{ await fetch(`https://api.github.com/repos/${username}/${repoName}/pages`,{method:'POST',headers:{'Authorization':'token '+token,'Content-Type':'application/json'},body:JSON.stringify({source:{branch:'main',path:'/'}})}); }catch{}
 return `https://${username}.github.io/${repoName}/`;
}

app.post('/api/create-master', requireAuth, async (req,res)=>{
 res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive');
 const send=(t,d)=>res.write(`data: ${JSON.stringify({type:t,data:d})}\n\n`); const log=(m)=>{console.log(m); send('log',m)};
 try{
 let {repoName, iconDataUrl, customFiles}=req.body; if(!repoName) throw new Error('Repo required');
 const cleanName=parseRepoName(repoName);
 log(`V22 FINAL | Target: ${cleanName}`);
 log(`Files: ${Object.keys(customFiles||{}).join(', ')}`);
 const url=await createRepoWithFiles(cleanName, customFiles||{}, iconDataUrl, log);
 log(`Deployed!`); send('done',{liveUrl:url, repoName:cleanName});
 }catch(e){ send('error', e.message); } res.end();
});

app.get('/', requireAuth, (req,res)=>res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V22 FINAL</title><style>body{background:#050507;color:#fff;font-family:monospace;padding:15px;margin:0}.c{max-width:700px;margin:auto} input,button,textarea{width:100%;padding:12px;margin:6px 0;background:rgba(255,255,255,0.06);border:1px solid #FF149333;color:#fff;border-radius:10px;box-sizing:border-box} textarea{height:160px;font-family:monospace;font-size:12px;resize:vertical} button{background:linear-gradient(90deg,#FF1493,#9D00FF);font-weight:900;border:none;cursor:pointer} #log{background:#000;border:1px solid #FF149320;border-radius:12px;padding:10px;height:250px;overflow:auto;font-size:11px;white-space:pre-wrap} h1{text-align:center;background:linear-gradient(90deg,#FF1493,#9D00FF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-size:1.8em;font-weight:900}.file-block{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px;margin:12px 0}.file-head{display:flex;gap:6px;align-items:center}.small{font-size:10px;color:#888}</style></head><body><div class="c"><h1>V22 FINAL 🏭</h1><p class="small" style="text-align:center">Splitter Method:./logo.png + Smart index.html handler</p><input type="file" id="logoFile" accept="image/*"><div id="preview"></div><input id="repo" placeholder="Repo name"><div style="margin-top:15px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Custom Files</h3><button style="width:auto;padding:6px 12px;font-size:12px" onclick="addFile()">+ Add File</button></div><div id="files"></div></div><button onclick="create()" style="margin-top:15px">Generate App</button><div id="log"></div><div id="status" style="margin-top:10px;text-align:center"></div></div><script>
let iconDataUrl=null;
document.getElementById('logoFile').addEventListener('change', e=>{const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{iconDataUrl=ev.target.result; document.getElementById('preview').innerHTML='<img src="'+iconDataUrl+'" style="width:60px;height:60px;border-radius:12px"> Logo OK';}; r.readAsDataURL(f);});
let fileCount=0;
function addFile(name='', content=''){
 fileCount++;
 const div=document.createElement('div'); div.className='file-block'; div.id='file-'+fileCount;
 div.innerHTML='<div class="file-head"><input placeholder="e.g. public/index.html or server.js" value="'+name+'" id="fname-'+fileCount+'" style="flex:1"><button style="width:auto;background:#;padding:8px 12px" onclick="document.getElementById(\\'file-'+fileCount+'\\').remove()">X</button></div><textarea placeholder="Paste code..." id="fcontent-'+fileCount+'">'+content+'</textarea>';
 document.getElementById('files').appendChild(div);
}
addFile('index.html','<!DOCTYPE html><html><head><meta charset=\\"UTF-8\\"><title>App</title><link rel=\\"icon\\" href=\\"./logo.png\\"><link rel=\\"apple-touch-icon\\" href=\\"./logo.png\\"><link rel=\\"manifest\\" href=\\"./manifest.json\\"><meta name=\\"theme-color\\" content=\\"#FF1493\\"><script src=\\"https://cdn.tailwindcss.com\\"><\\/script></head><body class=\\"bg-black text-white p-10 text-center\\"><h1>Hello World</h1></body></html>');
function log(m){const l=document.getElementById('log');l.innerHTML+='<div>['+new Date().toLocaleTimeString()+'] '+m+'</div>';l.scrollTop=l.scrollHeight}
async function create(){
 const repo=document.getElementById('repo').value; if(!repo){alert('Enter repo name');return}
 const customFiles={};
 document.querySelectorAll('.file-block').forEach(b=>{
 const id=b.id.split('-')[1];
 const fname=document.getElementById('fname-'+id).value.trim();
 const fcontent=document.getElementById('fcontent-'+id).value;
 if(fname && fcontent) customFiles[fname]=fcontent;
 });
 if(Object.keys(customFiles).length===0){alert('Add file');return}
 document.getElementById('log').innerHTML=''; log('Starting V22 FINAL...');
 const r=await fetch('/api/create-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repoName:repo, iconDataUrl:iconDataUrl, customFiles:customFiles})});
 const reader=r.body.getReader(); const dec=new TextDecoder(); let buf='';
 while(true){const {done,value}=await reader.read(); if(done)break; buf+=dec.decode(value,{stream:true}); let lines=buf.split('\\n\\n'); buf=lines.pop(); for(let line of lines){if(!line.startsWith('data:'))continue; try{let j=JSON.parse(line.slice(5)); if(j.type==='log')log(j.data); if(j.type==='done'){document.getElementById('status').innerHTML='DONE!<br><a href="'+j.data.liveUrl+'" target="_blank" style="color:#0ff">'+j.data.liveUrl+'</a>'; log('Live: '+j.data.liveUrl)} if(j.type==='error'){document.getElementById('status').innerHTML=j.data; log('Error: '+j.data)}}catch{}} }
}
<\/script></body></html>`));
app.listen(PORT,()=>console.log('V22 FINAL on '+PORT));
