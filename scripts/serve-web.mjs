import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import https from 'node:https';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../frontend/dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
 if(req.url?.startsWith('/api/')){
  const target=new URL(req.url,process.env.PUBLIC_API_URL||'http://localhost:8080');
  const forwarded=(target.protocol==='https:' ? https : http).request(target,{method:req.method,headers:{...req.headers,host:target.host}},reply=>{res.writeHead(reply.statusCode||502,reply.headers);reply.pipe(res);});
  forwarded.on('error',()=>{res.writeHead(502,{'Content-Type':'application/json'});res.end('{"ok":false}');});req.pipe(forwarded);return;
 }
 let filename;try{filename=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
 if(filename==='/')filename='/index.html';const target=path.resolve(root,'.'+filename);
 if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||fs.statSync(target).isDirectory()){res.writeHead(404);res.end('Not found');return;}
 res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(target).pipe(res);
});const port=Number(process.env.WEB_PORT||5173);
server.listen(port,'0.0.0.0',()=>console.log(`StreamGuard frontend: http://localhost:${port}`));
