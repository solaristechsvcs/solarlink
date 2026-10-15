import test from 'node:test';
import assert from 'node:assert/strict';
import {accountAuth,authorizeAction,installStaff} from './staff.js';
const user={id:1,role:'user',suspended:0},staff={id:2,role:'staff',suspended:0},admin={id:3,role:'admin',suspended:0};
test('authorization matrix prevents escalation and self-lockout',()=>{
 for(const action of ['role','suspend','restore']){
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
 const calls=[];let handler;let guards;
 const conn={beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),query:async sql=>{calls.push(sql);return sql.includes('COUNT')?[[{total}]]:[[{id:1}]]},execute:async(sql,args)=>{calls.push(sql);if(sql.startsWith('SELECT'))return [[String(args[0])===String(actor.id)?actor:target]];if(failAudit&&sql.startsWith('INSERT'))throw Error('audit unavailable');return []}};
 const app={use:(path,...fns)=>{if(fns.length>1)guards=fns},get(){},post:(path,fn)=>handler=fn};
 installStaff(app,{getConnection:async()=>conn},()=>{},()=>{});
 return {calls,guards,run:async(action,value)=>{const res=response();let error;await handler({session:{userId:actor.id},params:{id:String(target.id),action},body:{value,reason:'Reviewed report'}},res,e=>error=e);return {res,error}}};
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
