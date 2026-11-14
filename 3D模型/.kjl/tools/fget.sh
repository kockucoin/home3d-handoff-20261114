#!/bin/zsh
cd /Users/pandaking/Desktop/房屋/3D模型
kjl-cli tools furniture get --params '{}' > .kjl/fget.json
node -e "let j=require('./.kjl/fget.json');if(j.data?.savedTo)j=require(j.data.savedTo);const d=j.data.data;const a=d.furnitures||d.items||(Array.isArray(d)?d:null);if(!a){console.log(JSON.stringify(d).slice(0,500));process.exit()}console.log('count',a.length);a.forEach(f=>console.log(f.furnitureId,f.productId,[f.position.x,f.position.y,f.position.z].map(Math.round).join(','),[f.size.x,f.size.y,f.size.z].map(Math.round).join('x'),(f.rotation.z*180/Math.PI).toFixed(0)))"
