import path from 'node:path';
export const nameOk=s=>typeof s==='string'&&/^[a-z0-9_-]{3,30}$/.test(s);
export const reservedNames=new Set(['api','auth','staff','health']);
export function installPublicProfiles(app,pool,avatar,root){
 app.get('/api/profile/:username',async(req,res,next)=>{try{
  const username=req.params.username.toLowerCase();
  if(!nameOk(username))return res.status(404).json({error:'Not found'});
  const [[u]]=await pool.execute('SELECT id,role,discord_id,discord_avatar,username,display_name,bio,profile_image,background_image,banner_image,accent_color FROM users WHERE username=? AND suspended=0',[username]);
  if(!u)return res.status(404).json({error:'Not found'});
  const [links]=await pool.execute('SELECT title AS label,url FROM profile_links WHERE user_id=? ORDER BY position,id',[u.id]);
  res.json({username:u.username,name:u.display_name,bio:u.bio,avatar_url:u.profile_image||avatar(u.discord_id,u.discord_avatar),profile_image:u.profile_image,background_image:u.background_image,banner_image:u.banner_image,accent_color:u.accent_color,role:u.role,links});
 }catch(e){next(e)}});
 // Register after application routes so they retain their existing behavior.
 app.get('/:username',async(req,res,next)=>{try{
  const username=req.params.username.toLowerCase();
  if(!nameOk(username)||reservedNames.has(username))return next();
  const [[u]]=await pool.execute('SELECT id FROM users WHERE username=? AND suspended=0',[username]);
  if(!u)return res.status(404).send('Profile not found');
  res.set('Cache-Control','no-store');
  res.sendFile(path.join(root,'index.html'));
 }catch(e){next(e)}});
}
