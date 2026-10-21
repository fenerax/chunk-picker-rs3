import { writeFileSync } from 'node:fs';
const pages=['Archaeology','Venator remains','Venator dagger','Legionary remains','Castra debris','Centurion remains','Fort debris','Mystery remains','Material cache (Third Age iron)','Material cache (Zarosian insignia)','Material cache (samite silk)','Material cache (imperial steel)','Material cache (white oak)','Material cache (triskelion)','Zarosian I','Breaking the Seal','Infernal Source Dig Site','Archaeology collections','Moonrise Dig Site'];
const results=[];
for(const page of pages){
 const api='https://runescape.wiki/api.php?'+new URLSearchParams({action:'parse',page,prop:'wikitext|revid',format:'json'});
 try {const response=await fetch(api),data=await response.json();
 if(data.error){results.push({page,error:data.error});continue;}
 const text=data.parse.wikitext['*'];
 results.push({page,title:data.parse.title,revision:data.parse.revid,url:`https://runescape.wiki/w/${encodeURIComponent(data.parse.title.replaceAll(' ','_'))}?oldid=${data.parse.revid}`,
 fields:text.split('\n').filter(s=>/^\s*\|\s*(name|members|level|archaeology|id|xp|materials|artefacts|location)\s*=/i.test(s)),wikitext:text});
 }catch(error){results.push({page,error:error.message});}
}
const output=process.argv[2];if(!output)throw new Error('Supply a new output path.');
writeFileSync(output,JSON.stringify(results),{flag:'wx'});
console.log(JSON.stringify(results.map(({wikitext,...row})=>row)));
