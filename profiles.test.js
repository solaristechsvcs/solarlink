import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installPublicProfiles} from './profiles.js';
const root=fileURLToPath(new URL('.',import.meta.url));
test('public username URLs load without login and return all saved links',async()=>{
 const calls=[];const profile={id:1,username:'xenosphinx',display_name:'Xeno',role:'staff',bio:'Hello',profile_image:'https://example.com/avatar.png',banner_image:'https://example.com/banner.png',background_image:null,accent_color:'#123456'};
 const links=[{label:'Website',url:'https://example.com/'},{label:'Community',url:'https://discord.com/'}];
 const pool={execute:async(sql,args)=>{calls.push(sql);if(sql.includes('profile_links'))return [links];return [args[0]==='xenosphinx'?[profile]:[]]}};
 const app=express();app.get('/health',(req,res)=>res.json({ok:true}));app.get('/staff',(req,res)=>res.status(401).end());installPublicProfiles(app,pool,()=>null,root);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 try{
 const page=await fetch(url+'/xenosphinx');assert.equal(page.status,200);assert.match(await page.text(),/id="pLinks"/);assert.equal(page.headers.get('cache-control'),'no-store');
 const data=await (await fetch(url+'/api/profile/Xenosphinx')).json();assert.deepEqual(data.links,links);assert.equal(data.role,'staff');assert.equal(data.profile_image,profile.profile_image);assert.equal(data.accent_color,'#123456');assert.equal(data.name,'Xeno');
 for(const p of ['/missing','/suspended','/bad.name','/api/profile/missing'])assert.equal((await fetch(url+p)).status,404);
 assert.equal((await fetch(url+'/health')).status,200);assert.equal((await fetch(url+'/staff')).status,401);
 assert.ok(calls.filter(s=>s.includes('FROM users')).every(s=>s.includes('suspended=0')));
 assert.ok(calls.some(s=>s.includes('ORDER BY position,id')));
 }finally{await new Promise(r=>server.close(r))}
});
test('public page renders saved links safely and owner preview exposes clean share URL',()=>{
 const html=readFileSync(new URL('index.html',import.meta.url),'utf8');const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('initialize();','');
 function node(){return {style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},children:[],addEventListener(){},replaceChildren(){this.children=[]},append(n){this.children.push(n)}}}
 for(const pathname of ['/xenosphinx','/']){
 const nodes=new Map();const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node};
 const location={pathname,search:'',origin:'https://link.solaristechsvcs.com',hash:''};const window={remoteProfile:{username:'xenosphinx',name:'Xeno',role:'staff',links:[{label:'<b>Website</b>',url:'https://example.com/'}]},scrollTo(){}};
 vm.runInNewContext(script+';showProfile();',{document,location,window,URL,URLSearchParams});
 assert.equal(nodes.get('pLinks').children.length,1);assert.equal(nodes.get('pLinks').children[0].href,'https://example.com/');assert.equal(nodes.get('pLinks').children[0].textContent,'<b>Website</b> ↗');
 assert.equal(nodes.get('publicProfileLink').href,'https://link.solaristechsvcs.com/xenosphinx');assert.equal(location.hash,pathname==='/'?'profile':'');
 }
});
