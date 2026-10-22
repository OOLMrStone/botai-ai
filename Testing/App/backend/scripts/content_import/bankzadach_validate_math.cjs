'use strict';
const {createRequire}=require('node:module');
const katex=createRequire(process.argv[2])('katex');
let raw='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',x=>{raw+=x;if(Buffer.byteLength(raw)>1024*1024)process.exit(1)});
process.stdin.on('end',()=>{
 const values=JSON.parse(raw);if(!Array.isArray(values)||values.length>200)process.exit(1);
 const outcomes=values.map(item=>{
  const [value,displayMode]=Array.isArray(item)?item:[item,false];
  if(typeof value!=='string'||!value.trim()||value.length>4000||/\\(?:href|url|html\w*|includegraphics|def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand|global|csname|input|include|write|openout|read|catcode)\b/.test(value))return false;
  try{katex.renderToString(value,{displayMode:displayMode===true,trust:false,throwOnError:true,strict:'error',maxExpand:1000,maxSize:10,macros:{}});return true}catch{return false}
 });process.stdout.write(JSON.stringify(outcomes));
});
