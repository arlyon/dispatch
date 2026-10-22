#!/usr/bin/env node
// Deterministic read-only provider fixture. Each invocation consumes one reply.
const fs=require('node:fs'),path=require('node:path');
const root=path.dirname(__filename),countFile=path.join(root,'count');
const index=fs.existsSync(countFile)?Number(fs.readFileSync(countFile,'utf8')):0;
fs.writeFileSync(countFile,String(index+1));
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(process.argv.slice(2))+'\n');
fs.writeFileSync(path.join(root,'pid'),String(process.pid));
const reply=JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8'))[index];
if(!reply){process.stderr.write('unexpected fake gh invocation');process.exit(9);}
const finish=()=>{process.stdout.write(reply.stdout||'');process.stderr.write(reply.stderr||'');process.exit(reply.code||0);};
if(reply.waitForRelease){const timer=setInterval(()=>{if(fs.existsSync(path.join(root,'release'))){clearInterval(timer);finish();}},10);}else setTimeout(finish,reply.delayMs||0);
