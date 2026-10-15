import crypto from 'node:crypto';
import {nameOk,reservedNames} from './profiles.js';
export const profileColumns='username,display_name,bio,profile_image,background_image,banner_image,accent_color';
export function profileVersion(user,links){return crypto.createHash('sha256').update(JSON.stringify([profileColumns.split(',').map(key=>user[key]),links.map(l=>[l.label,l.url])])).digest('hex')}
export function validateStaffProfile(p){
 if(!p||!nameOk(p.username)||reservedNames.has(p.username)||typeof p.name!=='string'||p.name.length>60||typeof p.bio!=='string'||p.bio.length>240||!Array.isArray(p.links)||p.links.length>30)throw Error('Invalid profile fields or reserved username');
 const links=p.links.map(l=>{if(!l||typeof l.label!=='string'||!l.label.trim()||l.label.length>80||typeof l.url!=='string'||l.url.length>2048)throw Error('Invalid link');let u;try{u=new URL(l.url)}catch{throw Error('Invalid link URL')}if(!['https:','http:'].includes(u.protocol))throw Error('Links must use HTTP(S)');return {label:l.label.trim(),url:u.href}});
 const images=['profile_image','background_image','banner_image'].map(key=>{const value=p[key];if(value==null||value==='')return null;if(typeof value!=='string'||value.length>2048)throw Error('Invalid image URL');let u;try{u=new URL(value)}catch{throw Error('Invalid image URL')}if(u.protocol!=='https:'||u.username||u.password)throw Error('Images must use HTTPS');return u.href});
 const color=p.accent_color||'#a36aff';if(typeof color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(color))throw Error('Invalid accent color');
 // Explicit fields only: roles, suspension, Discord identity and IDs are never writable here.
 return {values:[p.username,p.name.trim(),p.bio.trim(),...images,color],links};
}
