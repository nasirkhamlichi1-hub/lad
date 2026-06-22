// Generates a vector PDF of the accreditation process map (no deps).
const fs = require('fs');
const W = 1180, H = 1000;
const C = {
  green:'0 0.42 0.247', greenbg:'0.909 0.953 0.933', glight:'0.875 0.941 0.902',
  teal:'0.051 0.451 0.467', tealbg:'0.890 0.945 0.941',
  gold:'0.788 0.569 0.227', goldbg:'0.980 0.949 0.886', purple:'0.604 0.424 1',
  red:'0.753 0.224 0.169', redbg:'0.992 0.925 0.922',
  ink:'0.078 0.125 0.169', slate:'0.353 0.396 0.451', line:'0.796 0.827 0.863',
  white:'1 1 1', bfe:'0.749 0.890 0.812',
};
let s = '';
const fy = y => H - y;
function rect(x,y,w,h,fill,stroke){ s += `${fill} rg ${stroke} RG 1 w ${x} ${fy(y+h)} ${w} ${h} re B\n`; }
function rectF(x,y,w,h,fill){ s += `${fill} rg ${x} ${fy(y+h)} ${w} ${h} re f\n`; }
function line(x1,y1,x2,y2,col){ s += `${col} RG 1.4 w ${x1} ${fy(y1)} m ${x2} ${fy(y2)} l S\n`; arrowhead(x1,y1,x2,y2,col); }
function arrowhead(x1,y1,x2,y2,col){
  const dx=x2-x1, dy=y2-y1, L=Math.hypot(dx,dy)||1, ux=dx/L, uy=dy/L, px=-uy, py=ux, a=8, b=4;
  const tx=x2, ty=y2, bx1=x2-ux*a+px*b, by1=y2-uy*a+py*b, bx2=x2-ux*a-px*b, by2=y2-uy*a-py*b;
  s += `${col} rg ${tx} ${fy(ty)} m ${bx1} ${fy(by1)} l ${bx2} ${fy(by2)} l f\n`;
}
function diamond(cx,cy,col,colF){ s += `${colF} rg ${col} RG 1 w ${cx} ${fy(cy-53)} m ${cx+135} ${fy(cy)} l ${cx} ${fy(cy+53)} l ${cx-135} ${fy(cy)} l B\n`; }
function esc(t){ return String(t).replace(/[≥]/g,'>=').replace(/[→]/g,'->').replace(/[–—]/g,'-')
  .replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')
  .replace(/·/g,'\\267').replace(/[^\x20-\x7e\\]/g,''); }
function tw(t,sz,bold){ return t.length*sz*(bold?0.55:0.5); }
function text(x,y,t,sz,col,bold,anchor){
  const w=tw(t,sz,bold); let xl=x; if(anchor==='middle')xl=x-w/2; else if(anchor==='end')xl=x-w;
  s += `BT /F${bold?2:1} ${sz} Tf ${col} rg ${xl} ${fy(y)} Td (${esc(t)}) Tj ET\n`;
}

// header
rectF(0,0,W,56,C.green);
text(32,35,'CLPD Accreditation - Process Map',20,C.white,true,'start');
text(1148,34,'Government of Dubai · Legal Affairs Department',11,C.bfe,false,'end');
// stage labels
[['SUBMIT',120],['REVIEW',300],['DECISION',540],['GO-LIVE',660]].forEach(([l,y])=>text(40,y,l,11,C.slate,true,'start'));

// spine boxes
rect(240,92,400,62,C.greenbg,C.green);
text(440,118,'Provider or firm submits an application',14,C.ink,true,'middle');
text(440,138,'materials · objectives · audience · attachments',11,C.slate,false,'middle');
rect(240,184,400,62,C.greenbg,C.green);
text(440,210,'Enters the LAD review queue - PENDING',14,C.ink,true,'middle');
text(440,230,'classified as Course/Activity or Provider/Entity',11,C.slate,false,'middle');
rect(240,276,400,62,C.tealbg,C.teal);
text(440,302,'Two LAD reviewers assigned - R1 & R2',14,C.ink,true,'middle');
text(440,322,'intelligence + super tier · plus Lex AI as a 3rd reviewer',11,C.slate,false,'middle');
rect(180,368,520,116,C.tealbg,C.teal);
text(440,392,'Each reviewer scores the rubric - pass >= 70% per section',14,C.ink,true,'middle');
rect(196,404,244,66,C.white,C.line);
text(318,423,'COURSE / ACTIVITY',10.5,C.teal,true,'middle');
text(318,441,'Activity Review · 5 criteria 0-4',11,C.slate,false,'middle');
text(318,457,'+ Trainer Review · 4 criteria 0-5',11,C.slate,false,'middle');
rect(448,404,236,66,C.white,C.line);
text(566,423,'PROVIDER / ENTITY',10.5,C.purple,true,'middle');
text(566,441,'Entity Review · 8 criteria',11,C.slate,false,'middle');
text(566,457,'max 20 · institutional capability',11,C.slate,false,'middle');

diamond(440,565,C.gold,C.goldbg);
text(440,560,'Both reviews >= 70%',13,C.ink,true,'middle');
text(440,578,'in every section?',13,C.ink,true,'middle');

text(452,648,'YES',10.5,C.green,true,'start');
rect(240,660,400,50,C.glight,C.green); text(440,690,'Approved - accreditation code issued',14,C.ink,true,'middle');
rect(240,728,400,46,C.glight,C.green); text(440,756,'Course published to the catalogue - bookable',14,C.ink,true,'middle');
rect(240,792,400,46,C.glight,C.green); text(440,820,'Lawyers book & attend sessions',14,C.ink,true,'middle');
rectF(240,856,400,46,C.green); text(440,884,'Attendance filed -> CPD points awarded',14,C.white,true,'middle');

text(598,556,'NO',10.5,C.red,true,'start');
rect(720,500,400,64,C.redbg,C.red);
text(920,526,'Request changes',14,C.ink,true,'middle');
text(920,546,'returns to the provider to revise & resubmit',11,C.slate,false,'middle');
rect(720,576,194,44,C.redbg,C.red); text(817,603,'Reject',14,C.ink,true,'middle');
rect(926,576,194,44,C.goldbg,C.gold); text(1023,603,'Defer to DG',14,C.ink,true,'middle');

// arrows
[[440,154,440,182],[440,246,440,274],[440,338,440,366],[440,484,440,510]].forEach(a=>line(...a,C.slate));
[[440,618,440,658],[440,710,440,726],[440,774,440,790],[440,838,440,854]].forEach(a=>line(...a,C.green));
line(575,565,716,533,C.red);
// dashed loop back (bezier) + arrowhead
s += `${C.red} RG 1.4 w [5 4] 0 d 720 ${fy(520)} m 640 ${fy(470)} 640 ${fy(180)} 644 ${fy(124)} c S [] 0 d\n`;
arrowhead(660,180,644,124,C.red);

// assemble PDF
const content = s;
const objs = [];
objs.push('<< /Type /Catalog /Pages 2 0 R >>');
objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`);
objs.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
let pdf = '%PDF-1.4\n'; const off = [];
objs.forEach((o,i)=>{ off[i]=Buffer.byteLength(pdf); pdf += `${i+1} 0 obj\n${o}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
off.forEach(o=>{ pdf += String(o).padStart(10,'0')+' 00000 n \n'; });
pdf += `trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
fs.writeFileSync('docs/accreditation-process-map.pdf', pdf, 'latin1');
console.log('PDF written:', Buffer.byteLength(pdf), 'bytes');
