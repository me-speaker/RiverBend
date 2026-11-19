import * as THREE from "./vendor/three.module.min.js";

// Each piece is one pickable mesh, including its houses, crops and trees.
// Baking the little wooden parts together keeps the board inexpensive to draw.
const R = 1.05;
const SIDE = R * .985;
const BED = -.3;
const WATER = .095;
const TOP = .27;
const scratch = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const matrix = new THREE.Matrix4();
const up = new THREE.Vector3(0, 1, 0);
const clay = "#ce644c", umber = "#714d3b", oak = "#a07749", cream = "#f8dfaa";
const corners = Array.from({length: 6}, (_, i) => {
  const a = i * Math.PI / 3 + Math.PI / 6;
  return [Math.cos(a) * SIDE, Math.sin(a) * SIDE];
});

function stream(points, width) {
  const path = new THREE.CatmullRomCurve3(points.map(([x,z]) => new THREE.Vector3(x,0,z)));
  return {points: path.getPoints(60), width};
}
const streams = [
  stream([[-5.4,-2.2],[-3.6,-1.9],[-2.65,-1.52],[-1.8,-1.22],[-1.05,-.62],[-.85,.1],[-.5,.85],[-.52,1.52],[-.39,2.1],[-.81,2.78],[-.97,3.55],[-1.65,4.9]], .31),
  stream([[4.8,-2.45],[3.4,-1.85],[2.75,-1.58],[2.32,-1.02],[1.68,-.73],[1.25,-.24],[1.05,.39],[.62,.78],[-.52,1.51]], .245),
];
function shore(x,z) {
  let closest = Infinity;
  for (const {points,width} of streams) {
    for (let i=1;i<points.length;i++) {
      const a=points[i-1], b=points[i], dx=b.x-a.x, dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
      closest=Math.min(closest,Math.hypot(x-a.x-t*dx,z-a.z-t*dz)-width);
    }
  }
  return closest;
}
function randomAt(seed) {
  let state=seed>>>0;
  return () => { state=(Math.imul(state,1664525)+1013904223)>>>0; return state/4294967296; };
}
const colorCache=new Map();
function tint(hex) {
  if (!colorCache.has(hex)) colorCache.set(hex,new THREE.Color(hex));
  return colorCache.get(hex);
}
const primitives=new Map();
function primitive(key, factory) {
  if (!primitives.has(key)) {
    const geometry=factory();
    primitives.set(key, geometry.index ? geometry.toNonIndexed() : geometry);
    if(geometry.index) geometry.dispose();
  }
  return primitives.get(key);
}
class Piece {
  constructor() {this.vertices=[]; this.colors=[];}
  point(x,y,z,color) {
    this.vertices.push(x,y,z);
    this.colors.push(color.r,color.g,color.b);
  }
  triangle(a,b,c,hex) {
    const color=tint(hex);
    for(const p of [a,b,c]) this.point(...p,color);
  }
  shape(geometry, pos, scale, quaternion, hex) {
    matrix.compose(new THREE.Vector3(...pos),quaternion,new THREE.Vector3(...scale));
    const points=geometry.getAttribute("position"), color=tint(hex);
    for(let i=0;i<points.count;i++) {
      scratch.fromBufferAttribute(points,i).applyMatrix4(matrix);
      this.point(scratch.x,scratch.y,scratch.z,color);
    }
  }
  finish() {
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(this.vertices,3));
    g.setAttribute("color",new THREE.Float32BufferAttribute(this.colors,3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
function yaw(a=0) {return rotation.setFromAxisAngle(up,a);}
function box(p,x,y,z,w,h,d,color,a=0) {
  p.shape(primitive("box",()=>new THREE.BoxGeometry()),[x,y,z],[w,h,d],yaw(a),color);
}
function taper(p,x,y,z,top,bottom,height,sides,color,a=0,depth=1) {
  const key="tube"+sides+"_"+top+"_"+bottom;
  const g=primitive(key,()=>new THREE.CylinderGeometry(top,bottom,1,sides));
  p.shape(g,[x,y,z],[1,height,depth],yaw(a),color);
}
function rock(p,x,y,z,w,h,d,color,a=0) {
  p.shape(primitive("rock",()=>new THREE.IcosahedronGeometry(1,0)),[x,y,z],[w,h,d],yaw(a),color);
}
function beam(p,a,b,r,color) {
  const dir=new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
  const length=dir.length();
  const q=new THREE.Quaternion().setFromUnitVectors(up,dir.normalize());
  p.shape(primitive("beam",()=>new THREE.CylinderGeometry(1,1,1,5)),
    a.map((value,i)=>(value+b[i])*.5),[r,length,r],q,color);
}
function grassHeight(tile) {
  return TOP+(tile.kind==="hill" ? .085 : tile.kind==="wood" ? .045 : 0);
}
function tileCenter(tile) {
  return [R*Math.sqrt(3)*(tile.q+tile.r/2),R*1.5*tile.r];
}
function landscape(p,tile,cx,cz,rng,winter,autumn) {
  const grassPal=winter ? ["#d7e1ca","#e0e5ce","#d1ddc6","#e4e7d3"] :
    autumn ? ["#c4c872","#cbd17a","#c7c379","#d2c98a"] :
    ["#94bd85","#a7cb8e","#8dc28e","#a1c991","#94bc87","#bad299"];
  const grass=grassPal[Math.floor(rng()*grassPal.length)];
  const high=grassHeight(tile);
  // Piecewise linear clipping makes smooth blue channels and narrow sandy banks
  // without building a high-resolution terrain grid.
  const steps=6;
  const vertex=(x,z)=>({x,z,v:shore(cx+x,cz+z)});
  const center=vertex(0,0);
  function clip(input,level,greater) {
    const out=[];
    for(let i=0;i<input.length;i++) {
      const a=input[i],b=input[(i+1)%input.length];
      const inside=greater ? a.v>=level : a.v<=level;
      const next=greater ? b.v>=level : b.v<=level;
      if(inside)out.push(a);
      if(inside!==next) {
        const t=(level-a.v)/(b.v-a.v);
        out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,v:level});
      }
    }
    return out;
  }
  const height=v=>WATER+(high-WATER)*THREE.MathUtils.clamp(v/.14,0,1);
  const paint=(poly,color)=>{
    for(let i=1;i<poly.length-1;i++) {
      p.triangle(...[poly[0],poly[i+1],poly[i]].map(a=>[a.x,height(a.v),a.z]),color);
    }
  };
  const bands=[[-10,-.115,winter?"#80c6c9":"#4caebc"],[-.115,0,winter?"#a8d5cf":"#79c7ba"],
    [0,.07,"#d6cb93"],[.07,.14,"#c8c288"],[.14,20,grass]];
  function surface(a,b,c) {
    const min=Math.min(a.v,b.v,c.v),max=Math.max(a.v,b.v,c.v);
    for(const [lo,hi,color] of bands) {
      if(max<lo || min>hi)continue;
      paint(clip(clip([a,b,c],lo,true),hi,false),color);
    }
  }
  for(let face=0;face<6;face++) {
    const a=corners[face],b=corners[(face+1)%6], grid=[];
    for(let i=0;i<=steps;i++) {
      grid[i]=[];
      for(let j=0;j<=steps-i;j++) {
        grid[i][j]=(i||j)?vertex((a[0]*i+b[0]*j)/steps,(a[1]*i+b[1]*j)/steps):center;
      }
    }
    for(let i=0;i<steps;i++)for(let j=0;j<steps-i;j++) {
      surface(grid[i][j],grid[i+1][j],grid[i][j+1]);
      if(i+j<steps-1) surface(grid[i+1][j],grid[i+1][j+1],grid[i][j+1]);
    }
    for(let j=0;j<steps;j++) {
      const u=grid[steps-j][j],v=grid[steps-j-1][j+1];
      const stripe=(y1,y2,y3,y4,col)=>{
        const A=[u.x,y1,u.z],B=[v.x,y2,v.z],C=[v.x,y3,v.z],D=[u.x,y4,u.z];
        p.triangle(A,B,C,col);p.triangle(A,C,D,col);
      };
      stripe(height(u.v),height(v.v),-.015,-.015,(u.v+v.v)<0?"#579a99":"#b7b782");
      stripe(-.015,-.015,-.093,-.093,"#bba689");
      stripe(-.093,-.093,BED,BED,["#9a8b7d","#a79888","#958c80"][face%3]);
    }
  }
  // Small clusters of strokes are easier to read at board scale than noisy textures.
  for(let i=0;i<37;i++) {
    const x=(rng()-.5)*1.65,z=(rng()-.5)*1.55;
    if(!inHex(x,z,.91))continue;
    const bank=shore(cx+x,cz+z);
    if(bank<-.065 && rng()<.6) {
      const len=.055+rng()*.16;
      box(p,x,WATER+.007,z,len,.008,.014,"#c0e2d6",-.12);
      if(rng()<.35) box(p,x+.04,WATER+.008,z+.023,.05,.006,.009,"#d6ebe1",-.12);
    } else if(bank>.16 && rng()<.65) {
      const col=winter?"#bbc6af":"#859f60";
      for(let k=0;k<2;k++) {
        const px=x+k*.027,sz=.035+rng()*.05;
        p.triangle([px-.014,high,z],[px+.01,high,z+.009],[px+.008+k*.013,high+sz,z],col);
      }
      if(rng()<.2)rock(p,x+.026,high+.03,z,.023,.018,.026,"#f1d99a");
    }
  }
  return high;
}
function inHex(x,z,size=1) {
  const radius=SIDE*size;
  return Math.abs(x)<=Math.sqrt(3)*radius/2 &&
    Math.abs(z)+Math.abs(x)/Math.sqrt(3)<=radius;
}
function anchor(cx,cz,x,z,margin) {
  let best=[x,z],score=-Infinity;
  for(let i=-3;i<=3;i++)for(let j=-3;j<=3;j++) {
    const a=x+i*.115,b=z+j*.115;
    if(!inHex(a,b,.89))continue;
    const s=Math.min(shore(cx+a,cz+b),margin)-Math.hypot(i,j)*.023;
    if(s>score){score=s;best=[a,b];}
  }
  return best;
}
function pine(p,x,y,z,s,rng,winter) {
  const layers=winter?["#598373","#81a390","#dfe6cf"]:
    [["#36796d","#518f78","#74a783"],["#45806f","#689b78","#8ab17d"],
     ["#447d75","#598f82","#78a693"]][Math.floor(rng()*3)];
  taper(p,x,y+.16*s,z,.044*s,.06*s,.34*s,6,umber);
  for(let i=0;i<3;i++) {
    const w=(.295-i*.057)*s;
    taper(p,x,y+(.43+.205*i)*s,z,0,w,(.47-i*.06)*s,7,layers[i],i*.34);
  }
}
function roundTree(p,x,y,z,s,rng,autumn,winter) {
  const leafy=winter?["#97bb9e","#c6d5ab"]:autumn?["#b68b50","#ddac5b"]:["#84a958","#adc371"];
  taper(p,x,y+.25*s,z,.045*s,.066*s,.51*s,6,umber);
  beam(p,[x,y+.23*s,z],[x+.16*s,y+.42*s,z],.035*s,oak);
  rock(p,x,y+.59*s,z,.34*s,.38*s,.29*s,leafy[0],rng()*3);
  rock(p,x+.15*s,y+.59*s,z+.024*s,.23*s,.245*s,.24*s,leafy[1],rng()*3);
  rock(p,x-.07*s,y+.75*s,z,.21*s,.225*s,.2*s,leafy[1],rng()*3);
}
function fence(p,x,y,z,count,spacing,alongX=true) {
  const stepX=alongX?spacing:0,stepZ=alongX?0:spacing;
  for(let i=0;i<count;i++) {
    const dx=x+stepX*i,dz=z+stepZ*i;
    box(p,dx,y+.098,dz,.044,.195,.044,oak);
    if(i<count-1) {
      for(const h of [.07,.14])beam(p,[dx,y+h,dz],[dx+stepX,y+h,dz+stepZ],.016,"#b99765");
    }
  }
}
function roof(p,x,y,z,w,h,d,col) {
  const lt=[x-w/2,y,z-d/2],lb=[x-w/2,y,z+d/2],rt=[x+w/2,y,z-d/2],rb=[x+w/2,y,z+d/2];
  const top=[x,y+h,z-d/2],bot=[x,y+h,z+d/2];
  p.triangle(lt,lb,bot,col); p.triangle(lt,bot,top,col);
  p.triangle(top,bot,rb,col);p.triangle(top,rb,rt,col);
  p.triangle(lb,rb,bot,col);p.triangle(rt,lt,top,col);
}
function cottage(p,x,y,z,s,roofColor,large=false) {
  const w=(large?.67:.51)*s,h=(large?.48:.41)*s,d=(large?.78:.59)*s;
  box(p,x,y+.035*s,z,w+.055*s,.07*s,d+.055*s,"#adad91");
  box(p,x,y+h/2+.06*s,z,w,h,d,cream);
  const eave=y+h+.06*s;
  const top=.265*s;
  roof(p,x,eave,z,w*1.28,top,d*1.22,roofColor);
  beam(p,[x,eave+top,z-d*.62],[x,eave+top,z+d*.62],.025*s,"#8c523a");
  for(const side of [-1,1]) {
    beam(p,[x+side*w*.64,eave,z+d*.615],[x,eave+top,z+d*.615],.026*s,"#9f5940");
    box(p,x+side*w*.48,y+h*.53,z+d*.511,.035*s,h,.032*s,umber);
    box(p,x+w*.507,y+h*.59,z+side*d*.26,.023*s,h*.34,d*.15,"#465f59");
    box(p,x+w*.525,y+h*.43,z+side*d*.26,.05*s,.025*s,d*.19,oak);
  }
  box(p,x,y+h*.32,z+d*.511,w*.25,h*.65,.026*s,"#715740");
  box(p,x,y+h*.7,z+d*.526,w*.3,.035*s,.037*s,umber);
  box(p,x+w*.31,y+h*.62,z+d*.522,w*.19,h*.23,.025*s,"#536e65");
  box(p,x,y+.052*s,z+d*.55,w*.36,.075*s,.16*s,"#b5aa8b");
  box(p,x+w*.28,eave+top*.67,z-d*.29,.09*s,top*1.24,.085*s,"#b49576");
  if(large) {
    for(const dir of [-1,1]) {
      const a=x+dir*w*.47,b=x+dir*w*.21;
      beam(p,[a,eave-.015,z+d*.516],[b,y+h*.48,z+d*.516],.016*s,oak);
    }
    beam(p,[x+w*.51,eave-.05,z-d*.49],[x+w*.51,eave-.05,z+d*.49],.02*s,umber);
    for(const k of [-.45,0,.45])box(p,x+w*.516,y+h*.52,z+d*k,.023*s,h,.035*s,umber);
  }
}
function flag(p,x,y,z,h,color) {
  beam(p,[x,y,z],[x,y+h,z],.017,umber);
  const a=[x,y+h*.98,z],b=[x+.29,y+h*.93,z-.022],c=[x+.20,y+h*.75,z-.02];
  const d=[x+.28,y+h*.60,z-.02],e=[x,y+h*.65,z];
  for(const [i,j,k] of [[a,b,c],[a,c,e],[e,c,d]])p.triangle(i,j,k,color);
  rock(p,x,y+h+.015,z,.027,.027,.027,"#dab76c");
}
function hall(p,y) {
  cottage(p,-.075,y,.005,1.08,clay,true);
  cottage(p,-.355,y,-.245,.74,"#a95f43");
  const x=.19,z=-.15,base=y+.59;
  box(p,x,base+.16,z,.30,.32,.30,"#eed9a6");
  box(p,x,base+.17,z+.153,.095,.16,.015,"#526359");
  box(p,x+.152,base+.17,z,.016,.16,.097,"#526359");
  taper(p,x,base+.455,z,0,.31,.30,4,"#688e83",Math.PI/4);
  flag(p,x,base+.595,z,.36,"#ca4938");
  box(p,-.08,y+.009,.57,.20,.015,.37,"#cbb995");
  fence(p,.42,y,.35,3,.18,false);
  // The footbridge connects the central hall to the original fields.
  const bx=-.88,bz=.10,angle=-.23,len=.92;
  const point=(t,side,h)=>[bx+t*Math.cos(angle)-side*Math.sin(angle),h,bz+t*Math.sin(angle)+side*Math.cos(angle)];
  for(let i=0;i<12;i++) {
    const t=(i/11-.5)*len,cy=y+.028+.082*Math.cos(t*Math.PI/len);
    const [a,,b]=point(t,0,cy);
    box(p,a,cy,b,.083,.043,.23,i%2?"#d0a572":"#ba8a5c",-angle);
  }
  for(const side of [-.10,.10]) {
    let prev;
    for(let i=0;i<5;i++) {
      const t=(i/4-.5)*len,cy=y+.028+.082*Math.cos(t*Math.PI/len);
      const foot=point(t,side,cy),head=point(t,side,cy+.12);
      beam(p,foot,head,.017,umber);
      if(prev)beam(p,prev,head,.012,"#ab8759");
      prev=head;
    }
  }
}
function sheep(p,x,y,z,s) {
  for(const dx of [-.082,.085])for(const dz of [-.04,.04]) {
    box(p,x+dx*s,y+.05*s,z+dz*s,.036*s,.105*s,.032*s,"#635c4d");
  }
  rock(p,x,y+.16*s,z,.155*s,.12*s,.10*s,"#f8e8c5",.62);
  rock(p,x+.12*s,y+.175*s,z+.012*s,.071*s,.071*s,.063*s,"#746955");
  rock(p,x+.11*s,y+.21*s,z+.065*s,.024*s,.035*s,.028*s,"#675f4d");
}
function fields(p,x,y,z,rng,improved,autumn) {
  const rows=improved?5:3,w=improved?.92:.55,d=improved?.69:.43;
  box(p,x,y+.014,z,w,.028,d,"#967a4e");
  for(let i=0;i<rows;i++) {
    const dx=x-w/2+(i+.5)*w/rows,col=autumn?"#d9b35c":i%2?"#c7ad5c":"#b6a259";
    box(p,dx,y+.035,z,w/rows*.65,.045,d*.94,col);
    for(let j=0;j<(improved?8:5);j++) {
      const dz=z-d*.41+j*d*.82/(improved?7:4),h=.064+rng()*.028;
      const leaf=autumn?"#edc975":i%2?"#d8c46f":"#a5ac5f";
      taper(p,dx+.02,y+.042+h/2,dz,.008,.03,h,4,leaf);
      taper(p,dx-.025,y+.04+h*.36,dz+.023,.006,.024,h*.76,4,leaf);
    }
  }
  if(improved) {
    fence(p,x-w*.52,y,z+d*.55,5,w/4);
    box(p,x,y+.02,z-d*.56,w,.025,.065,"#7caaa0");
  }
}
function logs(p,x,y,z,s) {
  for(const [dx,dy] of [[-.08,.075],[.08,.075],[0,.2]]) {
    const a=[x+dx*s,y+dy*s,z-.23*s],b=[a[0],a[1],z+.23*s];
    beam(p,a,b,.076*s,"#886747");
    beam(p,b,[b[0],b[1],b[2]+.012],.068*s,"#d5b17a");
  }
}
function jetty(p,x,y,z,angle,s) {
  const point=(a,b)=>[x+s*(a*Math.cos(angle)+b*Math.sin(angle)),z+s*(-a*Math.sin(angle)+b*Math.cos(angle))];
  for(let i=0;i<8;i++) {
    const [a,b]=point(0,i*.088);
    box(p,a,y+.02,b,.37*s,.05*s,.082*s,i%2?"#bb9461":"#c5a375",angle);
  }
  for(const dx of [-.16,.16])for(const dz of [.03,.58]) {
    const [a,b]=point(dx,dz);
    taper(p,a,(y+.09+WATER-.05)/2,b,.024*s,.028*s,y+.14-WATER,6,umber);
  }
}
function boat(p,x,y,z,angle,s,sail) {
  const at=(dx,dy,dz)=>[x+s*(dx*Math.cos(angle)+dz*Math.sin(angle)),y+dy*s,z+s*(-dx*Math.sin(angle)+dz*Math.cos(angle))];
  const rim=[[0,.34],[.103,.15],[.104,-.17],[0,-.34],[-.104,-.17],[-.103,.15]];
  for(let i=0;i<6;i++) {
    const [a,b]=rim[i],[c,d]=rim[(i+1)%6];
    p.triangle(at(a,.092,b),at(c,.092,d),at(0,.09,0),"#936944");
    p.triangle(at(c,.092,d),at(a,.092,b),at(0,.002,0),"#594e40");
    beam(p,at(a,.096,b),at(c,.096,d),.013*s,"#cbab76");
  }
  for(const j of [-.12,.1])beam(p,at(-.082,.11,j),at(.082,.11,j),.018*s,oak);
  if(sail) {
    beam(p,at(0,.095,-.065),at(0,.63,-.065),.014*s,umber);
    const a=at(0,.6,-.061),b=at(.045,.24,.213),c=at(0,.23,-.061);
    p.triangle(a,b,c,"#f9e5af");p.triangle(c,b,a,"#f9e5af");
  }
}
function boulders(p,x,y,z,s,rng,winter) {
  for(const [dx,dz,w,h] of [[0,-.12,.44,.72],[-.31,.03,.28,.40],[.27,.12,.30,.48],[.10,.36,.19,.22]]) {
    const clr=["#8daba6","#879e9e","#9db4aa"][Math.floor(rng()*3)];
    const ry=rng()*.4;
    taper(p,x+dx*s,y+h*s*.48,z+dz*s,w*s*.46,w*s,h*s,5,clr,ry,.78);
    taper(p,x+dx*s,y+h*s*1.06,z+dz*s,w*s*.17,w*s*.46,h*s*.16,5,winter?"#e1e5ce":"#bdcabe",ry,.78);
  }
}
function waterSpot(cx,cz) {
  let best=null,score=Infinity;
  for(let x=-.75;x<=.75;x+=.12)for(let z=-.75;z<=.75;z+=.12) {
    if(!inHex(x,z,.82) || shore(cx+x,cz+z)>-.13)continue;
    const s=Math.hypot(x,z);
    if(s<score){best=[x,z];score=s;}
  }
  return best;
}
function warehouseYard(p,y,tile,rng) {
  const figures = [["zhang",-.29,"#4c846e"],["li",.40,"#bc794d"]];
  const house = [.17,-.23];
  cottage(p,house[0],y,house[1],1.04,"#986656",true);
  box(p,.13,y+.015,.33,.83,.03,.56,"#d7c9a7");
  logs(p,.56,y,.04,.67);
  logs(p,-.31,y,-.15,.62);
  roundTree(p,.59,y,-.27,.60,rng,false,false);
  if (tile.createdSite) flag(p,.56,y,.44,.44,"#e8b963");
  for (const [id,x,coat] of figures) {
    if (tile.occupant === id) {
      box(p,house[0],y+.17,house[1]+.423,.126,.20,.021,"#efbd69");
      flag(p,house[0]+.23,y+.60,house[1]-.09,.28,coat);
      continue;
    }
    const z=.47;
    for (const foot of [-.036,.036]) box(p,x+foot,y+.049,z,.042,.098,.058,"#654f43");
    taper(p,x,y+.155,z,.056,.084,.151,8,coat);
    rock(p,x,y+.265,z,.064,.064,.063,"#e4ab83");
    taper(p,x,y+.308,z,.034,.066,.049,8,"#4c433a");
    if (tile.worked?.includes(id)) box(p,x,y+.132,z+.077,.15,.041,.045,"#b68755");
  }
}
function pieceGeometry(tile,season) {
  const p=new Piece(),[cx,cz]=tileCenter(tile);
  const rng=randomAt(42219+tile.q*3571+tile.r*8477), winter=season==="严冬",autumn=season==="金秋";
  const y=landscape(p,tile,cx,cz,rng,winter,autumn);
  const tree=(x,z,s,evergreen=true)=>{
    const [a,b]=anchor(cx,cz,x,z,.22);
    if(shore(cx+a,cz+b)<.14)return;
    if(evergreen)pine(p,a,y,b,s,rng,winter);else roundTree(p,a,y,b,s,rng,autumn,winter);
  };
  const stone=(x,z,s)=>{
    const v=shore(cx+x,cz+z);
    rock(p,x,(v<0?WATER:y)+.038*s,z,s*.12,s*.11,s*.15,"#b3b298",rng()*4);
  };
  if(tile.kind==="warehouse-demo") {
    warehouseYard(p,y,tile,rng);
  } else if(tile.kind==="town") {
    hall(p,y);
    tree(-.48,.28,.53,false);
  } else if(tile.kind==="wood") {
    const spots=[[-.43,-.15,.88],[.02,-.40,1.1],[.38,-.14,.91],[-.19,.19,.82],[.29,.34,.71],[.50,.11,.57]];
    for(let i=0;i<(tile.improved?3:spots.length);i++) {
      const [x,z,s]=spots[i];
      tree(x+(rng()-.5)*.13,z+(rng()-.5)*.13,s*(.83+.27*rng()),tile.id!=="backwoods"||i%3===0);
    }
    if(tile.improved) {
      const [x,z]=anchor(cx,cz,-.16,.30,.32);
      cottage(p,x,y,z,.67,"#966b4a");
      logs(p,x+.36,y,z+.04,.82);
    } else stone(-.43,.4,1);
  } else if(tile.kind==="farm") {
    const [x,z]=anchor(cx,cz,-.12,.01,.62);
    if(tile.improved || tile.id==="upland")fields(p,x,y,z,rng,tile.improved,autumn);
    if(tile.improved) {
      const [a,b]=anchor(cx,cz,.37,-.40,.22);
      cottage(p,a,y,b,.59,"#be8253");
    } else {
      tree(.25,-.24,.75,false);
      if(tile.id!=="upland")tree(-.25,.16,.53,false);
      fence(p,-.38,y,.46,4,.17);
      stone(-.4,-.26,.77);
      if(tile.id==="west_meadow" || tile.id==="north_field") {
        const [sx,sz]=anchor(cx,cz,.13,.23,.24);
        sheep(p,sx,y,sz,.88);
        sheep(p,sx+.22,y,sz-.14,.65);
      }
    }
  } else if(tile.kind==="hill") {
    const [x,z]=anchor(cx,cz,.04,-.05,.48);
    boulders(p,x,y,z,tile.id==="south_ridge"?.86:1.13,rng,winter);
    tree(-.43,.22,.58);
    stone(.38,.41,1.15);
  } else if(tile.kind==="trade" || tile.kind==="river") {
    const water=waterSpot(cx,cz);
    if(tile.improved) {
      const [x,z]=anchor(cx,cz,.21,-.04,.41);
      cottage(p,x,y,z,.76,"#78958a");
      const [a,b]=anchor(cx,cz,-.13,.48,.18);
      for(const [dx,dz] of [[0,0],[.14,.04],[.06,-.13]]) {
        box(p,a+dx,y+.065,b+dz,.11,.13,.11,"#b28c58");
        box(p,a+dx,y+.135,b+dz,.115,.012,.028,cream);
      }
    }
    if(water) {
      const [wx,wz]=water;
      if(tile.improved) {
        const [lx,lz]=anchor(cx,cz,wx+.15,wz,.21);
        jetty(p,lx,y,lz,Math.atan2(wx-lx,wz-lz),.76);
      }
      if(tile.improved || ["east_river","south_river","upper_river"].includes(tile.id))
        boat(p,wx,WATER+.01,wz,tile.id==="east_river"?.93:tile.id==="upper_river"?1.24:-.41,.88,tile.id!=="upper_river");
      for(let k=0;k<6;k++) {
        const x=wx+(rng()-.5)*.95,z=wz+(rng()-.5)*.86;
        const edge=shore(cx+x,cz+z);
        if(inHex(x,z,.93)&&edge>=-.025 && edge<=.15)
          beam(p,[x,WATER,z],[x+.032,WATER+.2+rng()*.12,z],.012,"#9f9e59");
      }
    }
    if(!tile.improved) {
      tree(-.40,-.29,tile.kind==="trade"?.7:.55,false);
      stone(.41,.32,1.05);stone(.32,.40,.62);
      if(tile.kind==="trade") {
        const [x,z]=anchor(cx,cz,.16,-.03,.24);
        for(let k=0;k<5;k++) {
          const dx=x+(rng()-.5)*.17,dz=z+(rng()-.5)*.19,h=.15+.085*rng();
          beam(p,[dx,y,dz],[dx+.015,y+h,dz],.008,"#a99c5d");
          taper(p,dx+.015,y+h,dz,.016,.017,.062,5,"#91603e");
        }
      }
    }
  }
  return p.finish();
}

const START_ANGLE=.37;
function outline(color,width) {
  const path=new THREE.CurvePath();
  for(let i=0;i<6;i++) {
    const a=corners[i],b=corners[(i+1)%6];
    path.add(new THREE.LineCurve3(new THREE.Vector3(a[0],0,a[1]),new THREE.Vector3(b[0],0,b[1])));
  }
  const marker=new THREE.Mesh(new THREE.TubeGeometry(path,36,width,5,true),
    new THREE.MeshBasicMaterial({color,depthTest:false,toneMapped:false}));
  marker.renderOrder=5;
  marker.visible=false;
  return marker;
}
export function createRiverMap(container,{frame:viewport=container,onSelect=()=>{}}={}) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"low-power"});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setClearColor(0,0);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate=false;
  const canvas=renderer.domElement;
  canvas.style.cssText="display:block;width:100%;height:100%;cursor:grab;";
  canvas.setAttribute("aria-label","河湾聚落三维地图，点击地块查看，横向拖动旋转");
  container.appendChild(canvas);

  const scene=new THREE.Scene(), camera=new THREE.OrthographicCamera(-5,5,4,-4,.1,100);
  scene.add(new THREE.HemisphereLight(0xf4fcff,0xc4d9ce,2.04));
  const sun=new THREE.DirectionalLight(0xfff8ec,1.65);
  sun.position.set(-4,9,6);
  sun.castShadow=true;
  Object.assign(sun.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.1,far:25});
  sun.shadow.mapSize.set(1024,1024);
  sun.shadow.radius=3;
  sun.shadow.normalBias=.012;
  sun.shadow.bias=-.00028;
  scene.add(sun);
  const mat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
  mat.shadowSide=THREE.FrontSide;
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.ShadowMaterial({opacity:.105}));
  floor.rotation.x=-Math.PI/2;
  floor.position.y=BED-.04;
  floor.receiveShadow=true;
  scene.add(floor);
  const pieces=new Map();
  const hoverRing=outline(0xecfae8,.015), selectRing=outline(0xf8d678,.033), planRing=outline(0xffa543,.022);
  scene.add(hoverRing,selectRing,planRing);
  const label=document.createElement("span");
  label.setAttribute("aria-hidden","true");
  label.style.cssText="position:absolute;z-index:3;pointer-events:none;display:none;white-space:nowrap;padding:4px 10px;border-radius:5px;background:#243d36ed;color:#fff8df;box-shadow:0 2px 5px #32443826;font:600 12px/1.5 system-ui,sans-serif;letter-spacing:.04em";
  container.appendChild(label);
  const oldPosition=container.style.position;
  const oldNorth=viewport.style.getPropertyValue("--north-angle");
  if(getComputedStyle(container).position==="static")container.style.position="relative";
  const raycaster=new THREE.Raycaster(), mouse=new THREE.Vector2();
  let angle=START_ANGLE, zoom=1, width=1,height=1, selectedId=null,plannedId=null,hoverId=null;
  let drag=null,frame=0,disposed=false;
  const render=()=>{
    if(!frame && !disposed)frame=requestAnimationFrame(()=>{frame=0;renderer.render(scene,camera);});
  };
  function frameBoard() {
    // Fit using the footprint projected onto the actual camera axes, also after a rotation.
    const aim=new THREE.Vector3(0,.38,0);
    camera.position.set(Math.sin(angle)*13,width<520?11.95:10.55,Math.cos(angle)*13).add(aim);
    camera.lookAt(aim);
    camera.updateMatrixWorld();
    // CSS rotations are clockwise from up. The view matrix supplies the actual
    // right/up components, including the foreshortening from the camera pitch.
    scratch.set(0,0,-1).transformDirection(camera.matrixWorldInverse);
    viewport.style.setProperty("--north-angle",Math.atan2(scratch.x,scratch.y)+"rad");
    const bounds=new THREE.Box2();
    for(const {mesh,tile} of pieces.values()) {
      const high=grassHeight(tile)+(tile.kind==="warehouse-demo"?.92:tile.kind==="hill"?.76:.50);
      for(const [x,z] of corners)for(const elevation of [BED,high]) {
        scratch.set(mesh.position.x+x,elevation,mesh.position.z+z).applyMatrix4(camera.matrixWorldInverse);
        bounds.expandByPoint(new THREE.Vector2(scratch.x,scratch.y));
      }
    }
    const empty=bounds.isEmpty();
    const halfWidth=empty?5.4:(bounds.max.x-bounds.min.x)*.54+.1;
    const halfHeight=empty?3.7:(bounds.max.y-bounds.min.y)*.54+.08;
    const midX=empty?0:(bounds.max.x+bounds.min.x)/2;
    const midY=empty?0:(bounds.max.y+bounds.min.y)/2;
    // Keep the full canvas interactive while fitting the board between the floating panels.
    const canvasRect=container.getBoundingClientRect();
    const fitRect=viewport.getBoundingClientRect();
    const fitX=fitRect.left-canvasRect.left+fitRect.width/2;
    const fitY=fitRect.top-canvasRect.top+fitRect.height/2;
    const unitsPerPixel=2*Math.max(
      halfWidth/Math.max(1,fitRect.width),
      halfHeight/Math.max(1,fitRect.height),
    )/zoom;
    camera.left=midX-fitX*unitsPerPixel;
    camera.right=camera.left+width*unitsPerPixel;
    camera.top=midY+fitY*unitsPerPixel;
    camera.bottom=camera.top-height*unitsPerPixel;
    camera.updateProjectionMatrix();render();
  }
  function resize() {
    width=Math.max(container.clientWidth,1);height=Math.max(container.clientHeight,1);
    renderer.setSize(width,height,false);
    frameBoard();
  }
  function marker(ring,id,offset) {
    const piece=pieces.get(id);
    ring.visible=Boolean(piece);
    if(piece)ring.position.set(piece.mesh.position.x,grassHeight(piece.tile)+offset,piece.mesh.position.z);
  }
  function markers() {
    marker(selectRing,selectedId,.016);
    marker(planRing,plannedId,.027);
    marker(hoverRing,hoverId===selectedId?null:hoverId,.025);
    render();
  }
  function clearHover() {hoverId=null;label.style.display="none";markers();}
  function pick(evt) {
    const rect=canvas.getBoundingClientRect();
    mouse.set((evt.clientX-rect.left)/rect.width*2-1,-(evt.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(mouse,camera);
    const hits=raycaster.intersectObjects([...pieces.values()].map(p=>p.mesh),false);
    return hits[0]?.object.userData.id??null;
  }
  function hover(evt) {
    if(evt.pointerType==="touch")return;
    hoverId=pick(evt);
    canvas.style.cursor=hoverId?"pointer":"grab";
    if(!hoverId) {clearHover();return;}
    const rect=container.getBoundingClientRect();
    label.textContent=pieces.get(hoverId).tile.name;
    label.style.display="block";
    label.style.left=Math.min(Math.max(4,evt.clientX-rect.left+12),width-label.offsetWidth-5)+"px";
    label.style.top=Math.max(4,evt.clientY-rect.top-29)+"px";
    markers();
  }
  function down(evt) {
    if(!evt.isPrimary||evt.button!==0)return;
    drag={id:evt.pointerId,x:evt.clientX,y:evt.clientY,angle,moved:false};
    canvas.setPointerCapture(evt.pointerId);
  }
  function move(evt) {
    if(!drag) {hover(evt);return;}
    if(evt.pointerId!==drag.id)return;
    const dx=evt.clientX-drag.x,dy=evt.clientY-drag.y;
    if(!drag.moved && Math.hypot(dx,dy)<6)return;
    drag.moved=true;
    canvas.style.cursor="grabbing";
    clearHover();
    angle=drag.angle-dx*.008;frameBoard();
  }
  function release(evt) {
    if(!drag||drag.id!==evt.pointerId)return;
    const clicked=!drag.moved && evt.type==="pointerup";
    drag=null;canvas.style.cursor="grab";
    if(canvas.hasPointerCapture(evt.pointerId))canvas.releasePointerCapture(evt.pointerId);
    if(clicked) {
      const id=pick(evt);
      if(id) {selectedId=id;markers();onSelect(id);}
    }
  }
  function zoomBy(factor) {zoom=THREE.MathUtils.clamp(zoom*factor,.68,1.85);frameBoard();}
  function wheel(evt) {
    evt.preventDefault();
    clearHover();zoomBy(Math.exp(-Math.max(-180,Math.min(180,evt.deltaY))*.0014));
  }
  const handlers={pointerdown:down,pointermove:move,pointerup:release,pointercancel:release,
    lostpointercapture:release,pointerleave:clearHover,wheel};
  for(const [name,handler] of Object.entries(handlers))canvas.addEventListener(name,handler,{passive:name!=="wheel"});
  const observer=new ResizeObserver(resize);
  observer.observe(container);
  if(viewport!==container)observer.observe(viewport);
  resize();
  return {
    update(tiles,{season="初春",selectedId:selection=selectedId,plannedId:plan=null}={}) {
      selectedId=selection;plannedId=plan;
      const ids=new Set(tiles.map(t=>t.id));
      let changed=false;
      for(const [id,piece] of pieces)if(!ids.has(id)) {
        scene.remove(piece.mesh);piece.mesh.geometry.dispose();pieces.delete(id);changed=true;
      }
      for(const tile of tiles) {
        const signature=[season,tile.kind,tile.improved,tile.q,tile.r,tile.occupant,tile.createdSite,tile.worked?.join(",")].join("/");
        let piece=pieces.get(tile.id);
        if(!piece) {
          const mesh=new THREE.Mesh(pieceGeometry(tile,season),mat);
          mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.id=tile.id;
          scene.add(mesh);
          piece={mesh};pieces.set(tile.id,piece);changed=true;
        } else if(piece.signature!==signature) {
          piece.mesh.geometry.dispose();piece.mesh.geometry=pieceGeometry(tile,season);changed=true;
        }
        const [x,z]=tileCenter(tile);
        piece.mesh.position.set(x,0,z);piece.mesh.updateMatrixWorld();
        piece.tile=tile;piece.signature=signature;
      }
      if(changed)renderer.shadowMap.needsUpdate=true;
      frameBoard();markers();
    },
    select(id){selectedId=id;markers();},
    zoomBy,
    rotateBy(radians){angle+=radians;clearHover();frameBoard();},
    resetView(){angle=START_ANGLE;zoom=1;clearHover();frameBoard();},
    dispose() {
      disposed=true;
      if(frame)cancelAnimationFrame(frame);
      observer.disconnect();
      for(const [name,handler] of Object.entries(handlers))canvas.removeEventListener(name,handler);
      for(const {mesh} of pieces.values())mesh.geometry.dispose();
      for(const o of [floor,hoverRing,selectRing,planRing]) {o.geometry.dispose();o.material.dispose();}
      mat.dispose();sun.shadow.dispose();renderer.dispose();label.remove();canvas.remove();
      if(oldNorth)viewport.style.setProperty("--north-angle",oldNorth);
      else viewport.style.removeProperty("--north-angle");
      container.style.position=oldPosition;
    },
  };
}
