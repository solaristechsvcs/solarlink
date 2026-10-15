import config from './config.js';
import express from 'express';
import session from 'express-session';
import mysql from 'mysql2/promise';
import MySQLStoreFactory from 'express-mysql-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const required = {
  'server.baseUrl': config.server.baseUrl,
  'session.secret': config.session.secret,
  'discord.clientId': config.discord.clientId,
  'discord.clientSecret': config.discord.clientSecret,
  'discord.redirectUri': config.discord.redirectUri,
  'mysql.host': config.mysql.host,
  'mysql.user': config.mysql.user,
  'mysql.database': config.mysql.database
};
for (const [key, value] of Object.entries(required)) {
  if (!value || String(value).startsWith('CHANGE_ME')) throw new Error('Set config.js: ' + key);
}
if (!config.mysql.password || String(config.mysql.password).startsWith('CHANGE_ME')) throw new Error('Set config.js: mysql.password');
if(config.session.secret.length<32) throw new Error('SESSION_SECRET must be at least 32 characters');
const base=new URL(config.server.baseUrl);
const callback=new URL(config.discord.redirectUri);
if(base.protocol!=='https:' && base.hostname!=='localhost') throw new Error('BASE_URL must use HTTPS');
if(callback.origin!==base.origin || callback.pathname!=='/auth/discord/callback') throw new Error('DISCORD_REDIRECT_URI must match BASE_URL origin and /auth/discord/callback');
const pool=mysql.createPool({host:config.mysql.host,port:Number(config.mysql.port||3306),user:config.mysql.user,password:config.mysql.password||'',database:config.mysql.database,waitForConnections:true,connectionLimit:10,decimalNumbers:true});
const MySQLStore=MySQLStoreFactory(session);
const store=new MySQLStore({createDatabaseTable:true,clearExpired:true},pool);
const app=express();
if(config.server.trustProxy === true)app.set('trust proxy',1);
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'32kb'}));
app.use(session({name:'solarlink.sid',secret:config.session.secret,store,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:base.protocol==='https:',maxAge:7*24*60*60*1000}}));
app.use('/auth',rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-7',legacyHeaders:false}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:180,standardHeaders:'draft-7',legacyHeaders:false}));
const csrf=(req,res,next)=>{if(req.method==='GET'||req.method==='HEAD')return next();if(req.get('origin')!==base.origin)return res.status(403).json({error:'Invalid origin'});next()};
const auth=(req,res,next)=>req.session.userId?next():res.status(401).json({error:'Login required'});
const nameOk=s=>typeof s==='string'&&/^[a-z0-9_-]{3,30}$/.test(s);
const avatar=(id,hash)=>hash?'https://cdn.discordapp.com/avatars/'+encodeURIComponent(id)+'/'+encodeURIComponent(hash)+'.png':null;
app.get('/health',async(req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true})}catch{res.status(503).json({ok:false})}});
app.get('/auth/discord',(req,res,next)=>{const state=crypto.randomBytes(32).toString('hex');req.session.oauthState=state;req.session.save(err=>{if(err)return next(err);const q=new URLSearchParams({client_id:config.discord.clientId,redirect_uri:callback.href,response_type:'code',scope:'identify',state});res.redirect('https://discord.com/oauth2/authorize?'+q)})});
app.get('/auth/discord/callback',async(req,res,next)=>{try{
 const state=req.query.state,code=req.query.code;
 if(typeof state!=='string'||typeof code!=='string'||!req.session.oauthState||state.length!==req.session.oauthState.length||!crypto.timingSafeEqual(Buffer.from(state),Buffer.from(req.session.oauthState)))return res.status(400).send('Invalid OAuth state. Please retry login.');
 delete req.session.oauthState;
 const tokenRes=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.discord.clientId,client_secret:config.discord.clientSecret,grant_type:'authorization_code',code,redirect_uri:callback.href})});
 if(!tokenRes.ok)return res.status(502).send('Discord authentication failed');
 const token=await tokenRes.json();
 const meRes=await fetch('https://discord.com/api/users/@me',{headers:{Authorization:'Bearer '+token.access_token}});
 if(!meRes.ok)return res.status(502).send('Unable to retrieve Discord identity');
 const me=await meRes.json();
 if(!/^\d{15,22}$/.test(me.id))return res.status(502).send('Invalid Discord identity');
 await pool.execute('INSERT INTO users (discord_id,discord_username,discord_avatar,display_name) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE discord_username=VALUES(discord_username),discord_avatar=VALUES(discord_avatar)',[me.id,me.username,me.avatar,me.global_name||me.username]);
 const [[user]]=await pool.execute('SELECT id FROM users WHERE discord_id=?',[me.id]);
 req.session.regenerate(err=>{if(err)return next(err);req.session.userId=user.id;req.session.save(err=>err?next(err):res.redirect('/#editor'))});
 }catch(e){next(e)}});
app.post('/auth/logout',csrf,(req,res,next)=>req.session.destroy(err=>err?next(err):(res.clearCookie('solarlink.sid'),res.json({ok:true}))));
app.get('/api/me',auth,async(req,res,next)=>{try{const [[u]]=await pool.execute('SELECT discord_id,discord_username,discord_avatar,username,display_name,bio FROM users WHERE id=?',[req.session.userId]);if(!u)return res.status(401).json({error:'Account not found'});const [links]=await pool.execute('SELECT title AS label,url FROM profile_links WHERE user_id=? ORDER BY position,id',[req.session.userId]);res.json({...u,avatar_url:avatar(u.discord_id,u.discord_avatar),links})}catch(e){next(e)}});
app.put('/api/me',auth,csrf,async(req,res,next)=>{const {username,name,bio,links}=req.body||{};
 if(!nameOk(username)||typeof name!=='string'||name.length>60||typeof bio!=='string'||bio.length>240||!Array.isArray(links)||links.length>30)return res.status(400).json({error:'Invalid profile fields'});
 const clean=[];for(const l of links){if(typeof l.label!=='string'||!l.label.trim()||l.label.length>80||typeof l.url!=='string'||l.url.length>2048)return res.status(400).json({error:'Invalid link'});try{const u=new URL(l.url);if(!['http:','https:'].includes(u.protocol))throw Error();clean.push([l.label.trim(),u.href])}catch{return res.status(400).json({error:'Links must be valid HTTP(S) URLs'})}}
 const conn=await pool.getConnection();try{await conn.beginTransaction();await conn.execute('UPDATE users SET username=?,display_name=?,bio=? WHERE id=?',[username,name.trim(),bio.trim(),req.session.userId]);await conn.execute('DELETE FROM profile_links WHERE user_id=?',[req.session.userId]);for(let i=0;i<clean.length;i++)await conn.execute('INSERT INTO profile_links(user_id,title,url,position) VALUES(?,?,?,?)',[req.session.userId,...clean[i],i]);await conn.commit();res.json({ok:true})}catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Username already taken'});next(e)}finally{conn.release()}});
app.get('/api/profile/:username',async(req,res,next)=>{try{if(!nameOk(req.params.username))return res.status(404).json({error:'Not found'});const [[u]]=await pool.execute('SELECT id,discord_id,discord_avatar,username,display_name,bio FROM users WHERE username=?',[req.params.username]);if(!u)return res.status(404).json({error:'Not found'});const [links]=await pool.execute('SELECT title AS label,url FROM profile_links WHERE user_id=? ORDER BY position,id',[u.id]);res.json({username:u.username,name:u.display_name,bio:u.bio,avatar_url:avatar(u.discord_id,u.discord_avatar),links})}catch(e){next(e)}});
const root=path.dirname(fileURLToPath(import.meta.url));app.get('/',(req,res)=>res.sendFile(path.join(root,'index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Internal server error'})});
const port=Number(config.server.port||3000);app.listen(port,'0.0.0.0',()=>console.log('SolarLink listening on '+port));
