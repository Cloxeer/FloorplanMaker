import { readFileSync, writeFileSync } from 'node:fs';
const f='tools/work/gn-2/gn-2.floorplan.json';
const p=JSON.parse(readFileSync(f,'utf8'));
const set=(num,pts)=>{const r=p.doc.items.find(i=>i.type==='room'&&i.number===num);for(const k of ['x','y','w','h'])delete r[k];r.shape='poly';r.points=pts;};
set('250',[[895,1065],[995,1065],[995,1160],[945,1160],[945,1210],[895,1210]]);
set('R253',[[1280,1065],[1325,1065],[1325,1210],[1220,1210],[1220,1145],[1280,1145]]);
writeFileSync(f,JSON.stringify(p));
