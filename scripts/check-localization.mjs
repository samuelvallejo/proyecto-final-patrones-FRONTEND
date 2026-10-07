/* Validate every Spanish translation referenced by the standalone frontend. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const locale=JSON.parse(fs.readFileSync(path.join(root,'frontend/public/locales/es.json'),'utf8'));
for(const [key,value] of Object.entries(locale))if(!/^[a-z][A-Za-z0-9]*$/.test(key)||typeof value!=='string')throw new Error(`Invalid Spanish translation: ${key}`);
function files(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
let references=0;
for(const filename of files(path.join(root,'frontend/src')).filter(file=>file.endsWith('.ts'))){const source=fs.readFileSync(filename,'utf8');for(const match of source.matchAll(/\bt\(['"]([A-Za-z0-9]+)['"]\)/g)){if(typeof locale[match[1]]!=='string')throw new Error(`Missing Spanish translation ${match[1]} in ${path.relative(root,filename)}`);references++;}if(/[\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00bf\u00a1]/.test(source))throw new Error(`Localized text must stay in Spanish locale files: ${path.relative(root,filename)}`);}
console.log(`Frontend localization check passed: ${references} references.`);
