import fs from 'node:fs';
const f='tools/work/rh-1/rh-1.floorplan.json';
const p=JSON.parse(fs.readFileSync(f));
const P={'103A':[[1260,5],[1945,5],[1945,760],[1165,760],[1165,630],[1260,630]],
'114':[[1055,900],[1137,900],[1137,855],[1507,855],[1507,905],[1595,905],[1595,1300],[1145,1300],[1145,1180],[1055,1180]],
'119':[[1595,905],[1675,905],[1675,855],[1865,855],[1865,885],[1925,885],[1925,1175],[1595,1175]]};
for(const it of p.doc.items) if(it.type==='room'&&P[it.number]){it.shape='poly';it.points=P[it.number];delete it.x;delete it.y;delete it.w;delete it.h;}
fs.writeFileSync(f,JSON.stringify(p));
