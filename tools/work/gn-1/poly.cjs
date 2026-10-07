const fs=require('fs');const f='gn-1.floorplan.json';
const p=JSON.parse(fs.readFileSync(f,'utf8'));
const P={
'131':[[380,605],[567,605],[567,695],[585,695],[585,755],[380,755]],
'120':[[220,1010],[315,1010],[315,970],[360,970],[360,950],[405,950],[405,1155],[220,1155]],
'125':[[185,790],[320,790],[320,935],[220,935],[220,865],[185,865]],
'172':[[1040,680],[1160,680],[1160,835],[1095,835],[1095,860],[1040,860]],
'R152':[[1190,945],[1220,945],[1220,1075],[1135,1075],[1135,1000],[1190,1000]]};
for(const it of p.doc.items){ if(it.type==='room'&&P[it.number]){it.shape='poly';it.points=P[it.number];for(const k of['x','y','w','h'])delete it[k];}}
fs.writeFileSync(f,JSON.stringify(p));
