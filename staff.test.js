import test from 'node:test';
import assert from 'node:assert/strict';
import {accountAuth,authorizeAction,installStaff} from './staff.js';
const user={id:1,role:'user',suspended:0},staff={id:2,role:'staff',suspended:0},admin={id:3,role:'admin',suspended:0};
test('authorization matrix prevents escalation and self-lockout',()=>{
 for(const action of ['role','suspend','restore','profile']){
  assert.ok(authorizeAction(user,staff,action,'admin'));
  assert.ok(authorizeAction(admin,admin,action,'user'));
  assert.ok(authorizeAction(staff,admin,action,'user'));
  assert.ok(authorizeAction({...admin,suspended:1},user,action,'staff'));
 }
 assert.ok(authorizeAction(staff,user,'role','admin'));
 assert.ok(authorizeAction(admin,user,'role','owner'));
 assert.equal(authorizeAction(admin,user,'role','staff'),null);
 assert.equal(authorizeAction(staff,user,'suspend'),null);
 assert.equal(authorizeAction(admin,staff,'restore'),null);
});
const response=()=>({code:200,status(n){this.code=n;return this},json(data){this.data=data;return this},set(){}});
test('every authenticated request rechecks current database state',async()=>{
 let record=admin;const auth=accountAuth({execute:async()=>[[record].filter(Boolean)]});let passed=0;
 let res=response();await auth({session:{}},res,()=>passed++);assert.equal(res.code,401);
 res=response();await auth({session:{userId:3}},res,()=>passed++);assert.equal(passed,1);
 record={...admin,suspended:1};res=response();await auth({session:{userId:3}},res,()=>passed++);assert.equal(res.code,403);assert.equal(passed,1);
 record=null;res=response();await auth({session:{userId:3}},res,()=>passed++);assert.equal(res.code,401);
});
function setup({actor=admin,target=user,total=2,failAudit=false}={}){
 const calls=[];const params=[];let handler;let guards;
 const conn={beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),query:async sql=>{calls.push(sql);return sql.includes('COUNT')?[[{total}]]:[[{id:1}]]},execute:async(sql,args)=>{calls.push(sql);params.push({sql,args});if(sql.includes('FROM profile_links'))return [target.links||[]];if(sql.startsWith('SELECT'))return [[String(args[0])===String(actor.id)?actor:target]];if(failAudit&&sql.startsWith('INSERT'))throw Error('audit unavailable');return []}};
 const app={use:(path,...fns)=>{if(fns.length>1)guards=fns},get(){},post:(path,fn)=>handler=fn};
 installStaff(app,{getConnection:async()=>conn},()=>{},()=>{});
 return {calls,params,guards,run:async(action,value,extra={})=>{const res=response();let error;await handler({session:{userId:actor.id},params:{id:String(target.id),action},body:{value,reason:'Reviewed report',...extra}},res,e=>error=e);return {res,error}}};
}
test('all staff API paths have authentication, role and origin middleware',()=>{const {guards}=setup();assert.equal(guards.length,4);const res=response();let passed=false;guards[1]({account:user},res,()=>passed=true);assert.equal(res.code,403);assert.equal(passed,false)});
test('moderation locks before reading roles and commits audit with change',async()=>{const s=setup();const {res}=await s.run('suspend');assert.equal(res.code,200);assert.ok(s.calls.indexOf('SELECT id FROM staff_guard WHERE id=1 FOR UPDATE')<s.calls.findIndex(x=>x.includes('SELECT id,role')));assert.ok(s.calls.some(x=>x.startsWith('INSERT INTO staff_audit')));assert.ok(s.calls.includes('commit'))});
test('audit failure rolls back moderation',async()=>{const s=setup({failAudit:true});const {error}=await s.run('suspend');assert.ok(error);assert.ok(s.calls.includes('rollback'));assert.ok(!s.calls.includes('commit'));assert.equal(s.calls.at(-1),'release')});
test('last active admin cannot be demoted or suspended',async()=>{for(const action of ['suspend','role']){const s=setup({target:{id:4,role:'admin',suspended:0},total:1});const {res}=await s.run(action,'user');assert.equal(res.code,409);assert.ok(!s.calls.includes('commit'))}});
test('stale session role is rechecked inside moderation transaction',async()=>{const s=setup({actor:{...admin,role:'user'}});const {res}=await s.run('suspend');assert.equal(res.code,403);assert.ok(s.calls.includes('rollback'))});

import express from 'express';
import {originCsrf} from './staff.js';
test('HTTP endpoints reject anonymous, ordinary, suspended and cross-origin requests',async()=>{
 let current=null,updates=0;
 const pool={execute:async(sql)=>sql.includes('WHERE id=')?[[current].filter(Boolean)]:[[]],getConnection:async()=>{updates++;throw Error('unexpected mutation')}};
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.session=current?{userId:current.id}:{};next()});
 installStaff(app,pool,accountAuth(pool),originCsrf('https://solarlink.example'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 try{
 for(const [account,status] of [[null,401],[user,403],[{...admin,suspended:1},403]]){current=account;for(const path of ['/users','/audit','/unknown'])assert.equal((await fetch(url+'/api/staff'+path)).status,status)}
 current=admin;assert.equal((await fetch(url+'/api/staff/users')).status,200);assert.equal((await fetch(url+'/api/staff/unknown')).status,404);
 for(const origin of [null,'https://attacker.example']){const headers={'Content-Type':'application/json'};if(origin)headers.Origin=origin;assert.equal((await fetch(url+'/api/staff/users/1/suspend',{method:'POST',headers,body:JSON.stringify({reason:'test'})})).status,403)}
 assert.equal(updates,0);
 const bad=await fetch(url+'/api/staff/users/1/role',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://solarlink.example'},body:'{}'});assert.equal(bad.status,400);
 }finally{await new Promise(resolve=>server.close(resolve))}
});

import {profileVersion,validateStaffProfile} from './staff-profile.js';
const saved={...user,username:'example',display_name:'Example',bio:'Original',profile_image:null,background_image:null,banner_image:null,accent_color:'#a36aff',links:[{label:'Website',url:'https://example.com/'}]};
const edited={username:'example',name:'Updated',bio:'Edited',profile_image:'https://example.com/avatar.png',background_image:null,banner_image:null,accent_color:'#123456',links:[{label:'New link',url:'https://example.org/'}]};
const editBody={profile:edited,version:profileVersion(saved,saved.links)};
test('profile validation rejects invalid content and excludes privilege fields',()=>{
 for(const patch of [{username:'staff'},{username:'bad/name'},{bio:'x'.repeat(241)},{links:[{label:'Danger',url:'javascript:alert(1)'}]},{profile_image:'http://example.com/image'},{profile_image:'https://user:pass@example.com/image'},{accent_color:'red'},{links:[null]},{links:Array(31).fill(edited.links[0])}])assert.throws(()=>validateStaffProfile({...edited,...patch}));
 const safe=validateStaffProfile({...edited,role:'admin',suspended:0,discord_id:'999',id:999});assert.equal(safe.values.length,7);assert.deepEqual(safe.values,['example','Updated','Edited','https://example.com/avatar.png',null,null,'#123456']);
});
test('staff edits ordinary profiles and audit is committed with links',async()=>{
 const s=setup({actor:staff,target:saved});const {res,error}=await s.run('profile',null,editBody);assert.ifError(error);assert.equal(res.code,200);assert.ok(s.calls.includes('commit'));
 const update=s.params.find(p=>p.sql.startsWith('UPDATE users'));assert.ok(!update.sql.includes('role='));assert.ok(!update.sql.includes('discord_id='));assert.deepEqual(update.args,[...validateStaffProfile(edited).values,String(saved.id)]);
 const audit=s.params.find(p=>p.sql.startsWith('INSERT INTO staff_audit'));assert.equal(audit.args[2],'profile_edit');assert.equal(audit.args[5],'Reviewed report');assert.ok(s.calls.some(sql=>sql.startsWith('DELETE FROM profile_links')));
});
test('profile edits roll back when auditing fails or a concurrent edit is detected',async()=>{
 const failed=setup({actor:staff,target:saved,failAudit:true});const {error}=await failed.run('profile',null,editBody);assert.ok(error);assert.ok(failed.calls.includes('rollback'));assert.ok(!failed.calls.includes('commit'));
 const stale=setup({actor:staff,target:{...saved,bio:'Updated by owner'}});const {res}=await stale.run('profile',null,editBody);assert.equal(res.code,409);assert.ok(!stale.calls.some(sql=>sql.startsWith('UPDATE users')));
});
test('profile edits enforce fresh actor/target roles and self restrictions',async()=>{
 for(const options of [{actor:staff,target:{...saved,role:'admin'}},{actor:staff,target:{...saved,role:'staff'}},{actor:{...staff,suspended:1},target:saved},{actor:{...staff,role:'user'},target:saved},{actor:{...staff,id:saved.id},target:saved}]){const s=setup(options);const {res}=await s.run('profile',null,editBody);assert.equal(res.code,403);assert.ok(!s.calls.includes('commit'))}
 const s=setup({actor:admin,target:{...saved,role:'staff'}});const {res}=await s.run('profile',null,editBody);assert.equal(res.code,200);
});
test('staff profile read endpoint enforces target permissions and returns version',async()=>{
 let current=staff,target=saved;
 const pool={execute:async(sql,args)=>sql.includes('profile_links')?[target.links]:[[String(args[0])===String(current.id)?current:target]]};
 const app=express();app.use((req,res,next)=>{req.session={userId:current.id};next()});installStaff(app,pool,accountAuth(pool),originCsrf('https://solarlink.example'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 try{
 let res=await fetch(url+'/api/staff/users/1/profile');assert.equal(res.status,200);const data=await res.json();assert.equal(data.version,profileVersion(saved,saved.links));assert.deepEqual(data.profile.links,saved.links);assert.equal(data.profile.role,undefined);
 target={...saved,role:'admin'};res=await fetch(url+'/api/staff/users/1/profile');assert.equal(res.status,403);
 current=admin;target={...saved,role:'staff'};assert.equal((await fetch(url+'/api/staff/users/1/profile')).status,200);
 }finally{await new Promise(r=>server.close(r))}
});
