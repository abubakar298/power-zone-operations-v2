// A one-page PDF whose only content is a JPEG 2000 (JPX) image: an 8 × 8 mid-grey square stretched over
// the page. Scanner apps save pages this way (or as JBIG2); the PDF reader needs its decoder files to draw
// them, and without them the page comes out blank white with no error.
const hex=(s:string)=>Buffer.from(s.replace(/\s+/g,''),'hex');
// Hand-built codestream: 8 × 8, one 8-bit component, no wavelet levels, one empty packet. All
// coefficients are zero, so after the level shift every pixel is 128 (mid-grey).
export const greyJpx=Buffer.concat([
 hex('FF4F'),
 hex('FF51 0029 0000 00000008 00000008 00000000 00000000 00000008 00000008 00000000 00000000 0001 07 01 01'),
 hex('FF52 000C 00 00 0001 00 00 04 04 00 01'),
 hex('FF5C 0004 40 48'),
 hex('FF90 000A 0000 0000000F 00 01'),
 hex('FF93 00'),
 hex('FFD9'),
]);
export function jpxPdf(){
 const content='q 595 0 0 842 0 0 cm /Im1 Do Q';
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
  null,
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
 ];
 const parts:Buffer[]=[Buffer.from('%PDF-1.5\n')];const offsets:number[]=[];let length=parts[0].length;
 objects.forEach((body,i)=>{offsets.push(length);const piece=body===null?Buffer.concat([Buffer.from(`${i+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /Filter /JPXDecode /Length ${greyJpx.length} >>\nstream\n`),greyJpx,Buffer.from('\nendstream\nendobj\n')]):Buffer.from(`${i+1} 0 obj\n${body}\nendobj\n`);parts.push(piece);length+=piece.length;});
 const xref=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
 return Buffer.concat([...parts,Buffer.from(xref)]);
}
