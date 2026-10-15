import {profileColumns,profileVersion,validateStaffProfile} from './staff-profile.js';
export const originCsrf=origin=>(req,res,next)=>{if(req.method==='GET'||req.method==='HEAD')return next();if(req.get('origin')!==origin)return res.status(403).json({error:'Invalid origin'});next()};
export function accountAuth(pool){return async(req,res,next)=>{try{
 if(!req.session.userId)return res.status(401).json({error:'Login required'});
 const [[u]]=await pool.execute('SELECT id,role,suspended FROM users WHERE id=?',[req.session.userId]);
 if(!u)return res.status(401).json({error:'Account not found'});
 if(u.suspended)return res.status(403).json({error:'Account suspended'});
 req.account=u;next();
}catch(e){next(e)}}}
export function authorizeAction(actor,target,action,value){
 if(!['staff','admin'].includes(actor.role)||actor.suspended)return 'Staff access required';
 if(String(actor.id)===String(target.id))return 'You cannot moderate your own account';
 if(action==='role'&&actor.role!=='admin')return 'Only admins can assign roles';
 if(actor.role==='staff'&&target.role!=='user')return 'Only admins can moderate staff';
 if(action==='role'&&!['user','staff','admin'].includes(value))return 'Invalid role';
 return null;
}
export function installStaff(app,pool,auth,csrf){
 const staff=(req,res,next)=>['staff','admin'].includes(req.account.role)?next():res.status(403).json({error:'Staff access required'});
 app.use('/api/staff',auth,staff,csrf,(req,res,next)=>{res.set('Cache-Control','no-store');next()});
 app.get('/api/staff/users',async(req,res,next)=>{try{
 const q=typeof req.query.q==='string'?req.query.q.trim():'';
 if(q.length>100)return res.status(400).json({error:'Search is too long'});
 const page=Math.floor(Math.max(1,Math.min(100000,Number(req.query.page)||1)));
 const [users]=await pool.execute("SELECT id,discord_id,discord_username,username,display_name,role,suspended,created_at FROM users WHERE LOCATE(?,CONCAT_WS(' ',discord_id,discord_username,username,display_name))>0 ORDER BY id LIMIT 51 OFFSET ?",[q,Math.floor(page-1)*50]);
 res.json({users:users.slice(0,50),hasMore:users.length>50,page:Math.floor(page),role:req.account.role,actorId:req.account.id});
 }catch(e){next(e)}});
 app.get('/api/staff/audit',async(req,res,next)=>{try{const [actions]=await pool.query('SELECT id,actor_id,target_id,action,old_value,new_value,reason,created_at FROM staff_audit ORDER BY id DESC LIMIT 100');res.json({actions})}catch(e){next(e)}});
 app.get('/api/staff/users/:id/profile',async(req,res,next)=>{try{
 if(!/^[1-9][0-9]{0,19}$/.test(req.params.id))return res.status(400).json({error:'Invalid user ID'});
 const [[target]]=await pool.execute('SELECT id,role,suspended,'+profileColumns+' FROM users WHERE id=?',[req.params.id]);
 if(!target)return res.status(404).json({error:'Account not found'});
 const denied=authorizeAction(req.account,target,'profile');if(denied)return res.status(403).json({error:denied});
 const [links]=await pool.execute('SELECT title AS label,url FROM profile_links WHERE user_id=? ORDER BY position,id',[target.id]);
 res.json({profile:{username:target.username||'',name:target.display_name,bio:target.bio,profile_image:target.profile_image,background_image:target.background_image,banner_image:target.banner_image,accent_color:target.accent_color,links},version:profileVersion(target,links)});
 }catch(e){next(e)}});
 app.post('/api/staff/users/:id/:action',async(req,res,next)=>{
 const {id,action}=req.params;const {value,reason}=req.body||{};
 if(!/^[1-9][0-9]{0,19}$/.test(id)||!['role','suspend','restore','profile'].includes(action)||typeof reason!=='string'||!reason.trim()||reason.length>500)return res.status(400).json({error:'Valid target, action and reason (1–500 characters) required'});
 let profile;
 if(action==='profile'){try{profile=validateStaffProfile(req.body.profile);if(typeof req.body.version!=='string'||!/^[a-f0-9]{64}$/.test(req.body.version))throw Error('Reload the profile before saving');}catch(e){return res.status(400).json({error:e.message})}}
 let conn;try{conn=await pool.getConnection();await conn.beginTransaction();
 // Serialize every moderation change, including concurrent demotions/suspensions.
 const [guard]=await conn.query('SELECT id FROM staff_guard WHERE id=1 FOR UPDATE');if(guard.length!==1)throw Error('Staff migration guard missing');
 const [[actor]]=await conn.execute('SELECT id,role,suspended FROM users WHERE id=? FOR UPDATE',[req.session.userId]);
 const [[target]]=await conn.execute('SELECT id,role,suspended'+(action==='profile'?','+profileColumns:'')+' FROM users WHERE id=? FOR UPDATE',[id]);
 if(!actor||!target){await conn.rollback();return res.status(404).json({error:'Account not found'})}
 const denied=authorizeAction(actor,target,action,value);
 if(denied){await conn.rollback();return res.status(403).json({error:denied})}
 if(action==='profile'){
 const [links]=await conn.execute('SELECT title AS label,url FROM profile_links WHERE user_id=? ORDER BY position,id FOR UPDATE',[id]);
 if(profileVersion(target,links)!==req.body.version){await conn.rollback();return res.status(409).json({error:'Profile changed since you opened it. Reload it before saving.'})}
 await conn.execute('UPDATE users SET username=?,display_name=?,bio=?,profile_image=?,background_image=?,banner_image=?,accent_color=? WHERE id=?',[...profile.values,id]);
 await conn.execute('DELETE FROM profile_links WHERE user_id=?',[id]);
 for(let i=0;i<profile.links.length;i++){const l=profile.links[i];await conn.execute('INSERT INTO profile_links(user_id,title,url,position) VALUES(?,?,?,?)',[id,l.label,l.url,i])}
 await conn.execute('INSERT INTO staff_audit(actor_id,target_id,action,old_value,new_value,reason) VALUES(?,?,?,?,?,?)',[actor.id,id,'profile_edit','saved profile','updated profile',reason.trim()]);
 await conn.commit();return res.json({ok:true});
 }
 const field=action==='role'?'role':'suspended',newValue=action==='role'?value:action==='suspend'?1:0;
 if(target.role==='admin'&&!target.suspended&&(action==='suspend'||(action==='role'&&value!=='admin'))){
 const [[{total}]]=await conn.query("SELECT COUNT(*) AS total FROM users WHERE role='admin' AND suspended=0");
 if(total<=1){await conn.rollback();return res.status(409).json({error:'Cannot remove the last active admin'})}
 }
 if(String(target[field])===String(newValue)){await conn.rollback();return res.json({ok:true,unchanged:true})}
 await conn.execute(`UPDATE users SET ${field}=? WHERE id=?`,[newValue,id]);
 await conn.execute('INSERT INTO staff_audit(actor_id,target_id,action,old_value,new_value,reason) VALUES(?,?,?,?,?,?)',[actor.id,target.id,action,String(target[field]),String(newValue),reason.trim()]);
 await conn.commit();res.json({ok:true});
 }catch(e){if(conn)await conn.rollback();if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Username already taken'});next(e)}finally{conn?.release()}
 });
 app.use('/api/staff',(req,res)=>res.status(404).json({error:'Not found'}));
}
