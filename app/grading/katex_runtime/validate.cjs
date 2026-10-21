'use strict';
const katex = require('katex');
// Mirrors botai-front config/math.ts and grid-rich-text.ts; parity fixtures guard drift.
const options = { throwOnError: true, output: 'htmlAndMathml', trust: false, maxExpand: 1000, maxSize: 10 };
const delimiters = [['$$', '$$', true], ['\\[', '\\]', true], ['\\(', '\\)', false], ['$', '$', false]];
const bareStart = /^\\(?:d?frac|tfrac|sqrt|begin|left|text|mathrm|mathbf|mathbb|log|ln|sin|cos|tan|cot|tg|ctg|lim|sum|prod|int|pi|alpha|beta|gamma|theta|omega|varphi|phi|Delta|infty)\b/;
const statement = /[=<>^_≤≥≠×·−±∈∪∩∅→⇒]|\\[a-zA-Z]+/;
const bareCharacters = /^[\dA-Za-z\s{}[\]()_^+\-*/=<>.,;:|!&%~'"π∞≤≥≠×·−±∈∪∩∅→⇒]+$/;
function escaped(s, index) { let n=0; for(let i=index-1;i>=0&&s[i]==='\\';i--)n++; return n%2!==0; }
function bareMath(s) {
  if (!(bareStart.test(s)||(!s.startsWith('\\')&&statement.test(s)))) return false;
  let depth=0; for(let i=0;i<s.length;i++){if(escaped(s,i))continue;if(s[i]==='{')depth++;if(s[i]==='}')depth--;if(depth<0)return false;} if(depth!==0)return false;
  const pattern=/\\(?:text|textrm|textbf|textit|operatorname)\s*\{/g;
  let result='',cursor=0,match;
  while((match=pattern.exec(s))){result+=s.slice(cursor,match.index);let d=1,end=pattern.lastIndex;while(end<s.length&&d>0){if(!escaped(s,end)){if(s[end]==='{')d++;if(s[end]==='}')d--;}end++;}cursor=end;pattern.lastIndex=end;}
  result=(result+s.slice(cursor)).replace(/\\(?:begin|end)\{(?:cases|aligned|align\*?|gathered|matrix|pmatrix|bmatrix)\}/g,'').replace(/\\(?:[a-zA-Z]+|[\\{}()[\]|,;! ])/g,'');
  return result.trim()===''||(bareCharacters.test(result)&&!/[A-Za-z]{2,}/.test(result));
}
function segments(source) {
  const found=[];let cursor=0;
  while(cursor<source.length){
    const delimiter=delimiters.find(d=>source.startsWith(d[0],cursor));
    if(delimiter&&!escaped(source,cursor)){
      const start=cursor+delimiter[0].length;let end=source.indexOf(delimiter[1],start);
      while(end!==-1&&(escaped(source,end)||(delimiter[1]==='$'&&(source[end-1]==='$'||source[end+1]==='$'))))end=source.indexOf(delimiter[1],end+delimiter[1].length);
      if(end!==-1){found.push({value:source.slice(start,end),displayMode:delimiter[2]});cursor=end+delimiter[1].length;continue;}
      cursor+=delimiter[0].length;continue;
    }
    if(cursor===0||source[cursor-1]==='\n'){
      const next=source.indexOf('\n',cursor),end=next===-1?source.length:next;
      const line=source.slice(cursor,end),expression=line.trim();
      if(bareMath(expression)){found.push({value:expression,displayMode:true});cursor+=line.indexOf(expression)+expression.length;continue;}
    }
    cursor++;
  }
  return found;
}
const chunks=[];let size=0;
process.stdin.on('data',chunk=>{size+=chunk.length;if(size>1048576)process.exit(2);chunks.push(chunk);});
process.stdin.on('end',()=>{
  try {
    const batch=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!Array.isArray(batch)||batch.length>4096||katex.version!=='0.16.22')process.exit(2);
    const issues=[];let count=0;
    for(const entry of batch){
      if(typeof entry.text!=='string'||typeof entry.path!=='string')process.exit(2);
      const formulas=entry.math?[{value:entry.text,displayMode:!!entry.displayMode}]:segments(entry.text);
      for(const formula of formulas){
        if(++count>4096)process.exit(2);
        try { katex.renderToString(formula.value,{...options,displayMode:formula.displayMode}); }
        catch(error){if(!(error instanceof katex.ParseError))throw error;if(issues.length<30)issues.push(entry.path);}
      }
    }
    process.stdout.write(JSON.stringify({version:katex.version,issues:[...new Set(issues)]}));
  }catch(error){process.exitCode=2;}
});
