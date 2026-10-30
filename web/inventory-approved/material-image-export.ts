/** Decode every logo before capture, including the first customer-copy page. */
export async function waitForMaterialImages(root:ParentNode){
 await Promise.all([...root.querySelectorAll<HTMLImageElement>('.igp-sheet img')].map(async img=>{
  if(!img.complete)await new Promise<void>((resolve,reject)=>{img.addEventListener('load',()=>resolve(),{once:true});img.addEventListener('error',()=>reject(Error('The document logo could not load. Refresh before downloading.')),{once:true});});
  if(!img.naturalWidth||!img.naturalHeight)throw Error('The document logo could not load. Refresh before downloading.');
  await img.decode();
 }));
}
export async function prepareMaterialImageClone(doc:Document){
 await waitForMaterialImages(doc);
 await Promise.all([...doc.querySelectorAll<HTMLImageElement>('.igp-sheet img')].map(async img=>{
  const canvas=doc.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Could not prepare the document logo.');
  ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);for(let n=0;n<pixels.data.length;n+=4){pixels.data[n]=0;pixels.data[n+1]=0;pixels.data[n+2]=0;}ctx.putImageData(pixels,0,0);img.src=canvas.toDataURL();img.style.filter='none';await img.decode();
 }));
}
