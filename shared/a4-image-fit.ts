/** Fit the whole rendered document within A4's 7 mm print margins.
 * Rendering height can grow with descriptions/site names; never crop or reject it. */
export function fitA4Image(pixelWidth:number,pixelHeight:number){
 if(!Number.isFinite(pixelWidth)||!Number.isFinite(pixelHeight)||pixelWidth<=0||pixelHeight<=0)throw Error('The document could not be rendered.');
 const scale=Math.min(196/pixelWidth,283/pixelHeight);
 const width=pixelWidth*scale,height=pixelHeight*scale;
 return {x:7+(196-width)/2,y:7,width,height};
}
