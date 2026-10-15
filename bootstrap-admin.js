import config from './config.js';
import mysql from 'mysql2/promise';
const discordId=process.argv[2];
if(!/^\d{15,22}$/.test(discordId||''))throw Error('Usage: node bootstrap-admin.js DISCORD_ID (log in with Discord first)');
const conn=await mysql.createConnection({...config.mysql,supportBigNumbers:true,bigNumberStrings:true});
try{
 await conn.beginTransaction();
 const [guard]=await conn.query('SELECT id FROM staff_guard WHERE id=1 FOR UPDATE');if(guard.length!==1)throw Error('Staff migration guard missing');
 const [[{total}]]=await conn.query("SELECT COUNT(*) AS total FROM users WHERE role='admin' AND suspended=0");
 if(Number(total)!==0)throw Error('An active admin already exists. Use the staff panel.');
 const [[user]]=await conn.execute('SELECT id,role,suspended FROM users WHERE discord_id=? FOR UPDATE',[discordId]);
 if(!user||user.suspended)throw Error('Target must be an existing, active account. Log in first.');
 await conn.execute("UPDATE users SET role='admin' WHERE id=?",[user.id]);
 await conn.execute("INSERT INTO staff_audit(actor_id,target_id,action,old_value,new_value,reason) VALUES(?,?,'bootstrap',?,'admin','Initial admin provisioned by database operator')",[user.id,user.id,user.role]);
 await conn.commit();console.log('Initial admin provisioned. Open /staff while logged in.');
}catch(e){await conn.rollback();throw e}finally{await conn.end()}
