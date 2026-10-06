// Synthetic ASCII shipping labels only: no customer names, addresses, or phone numbers.
export function fixturePdf(quantities=[1],firstRef=930000001,identifier='Wasn Saudi'){
 const fontId=3+quantities.length*2;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${quantities.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${quantities.length} >>`];
 for(const [i,quantity] of quantities.entries()){
  const content=['RedBox',`Ref # ${firstRef+i}`,`Trk # ${firstRef+100+i}`,`Quantity: ${quantity}`,...(i===0&&identifier?[identifier]:[])].map((line,index)=>`1 0 0 1 30 ${750-index*24} Tm (${line}) Tj`).join('\n');
  const stream=`BT /F1 14 Tf\n${content}\nET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
 }
 objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 let pdf='%PDF-1.7\n',offsets=[0];
 objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(pdf);
}
