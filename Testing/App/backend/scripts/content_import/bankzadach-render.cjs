'use strict';
const fs=require('node:fs');
const sharp=require('/app/node_modules/sharp');
const manifest=JSON.parse(fs.readFileSync('/input/manifest.json','utf8'));
if(!Array.isArray(manifest)||manifest.length<1||manifest.length>16)throw Error('batch');
(async()=>{
 const results=[];let pixels=0,bytes=0;
 for(const item of manifest){
  if(!/^[a-f0-9]{64}\.(svg|png|jpeg|webp)$/.test(item.file))throw Error('filename');
  const key=item.file.split('.')[0];
  try{
   const raw=fs.readFileSync('/input/'+item.file);
   if(raw.length>8*1024*1024)throw Error('input size');
   let options,meta;
   // Some SVG pt dimensions scale quadratically in this pinned renderer.
   // Lower density only within the same pixel limits; never disable the limits.
   for(const density of (item.file.endsWith('.svg')?[288,216,144,72]:[null])){
    const candidate={failOn:'warning',limitInputPixels:20000000,unlimited:false};
    if(density!==null)candidate.density=density;
    try{
     const probe=await sharp(raw,candidate).metadata();
     if(!['svg','png','jpeg','webp'].includes(probe.format)||probe.pages>1||!probe.width||!probe.height||probe.width>8192||probe.height>8192||probe.width*probe.height>20000000)continue;
     options=candidate;meta=probe;break;
    }catch{}
   }
   if(!meta)throw Error('metadata');
   const {data,info}=await sharp(raw,options).rotate().png({compressionLevel:9}).toBuffer({resolveWithObject:true});
   if(info.width>8192||info.height>8192||info.width*info.height>20000000||data.length>8*1024*1024)throw Error('output');
   if(pixels+info.width*info.height>64000000||bytes+data.length>64*1024*1024)throw Error('aggregate');
   pixels+=info.width*info.height;bytes+=data.length;
   fs.writeFileSync('/output/'+key+'.png',data,{flag:'wx',mode:0o600});
   results.push({key,status:'ok',width:info.width,height:info.height,bytes:data.length});
  }catch(e){results.push({key,status:'rejected',reason:'raster_decode_or_budget'});}
 }
 fs.writeFileSync('/output/render-report.json',JSON.stringify({results}),{flag:'wx',mode:0o600});
})().catch(()=>{console.error('media renderer failed');process.exitCode=1});
