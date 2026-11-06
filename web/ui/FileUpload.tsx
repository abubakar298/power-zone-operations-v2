import {forwardRef,useId,useRef,useState,type InputHTMLAttributes,type ChangeEvent} from 'react';
import {Button} from './Button.js';

export type UploadAttachment={id:string;filename:string;url?:string};
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'> & {
  type?:'file';
  /** Saved attachments are controlled by their owning form, including removal/audit. */
  attachments?:UploadAttachment[];
  onRemoveAttachment?:(file:UploadAttachment)=>void|Promise<void>;
  /** Clear values derived from an unsaved selection as well as its filename. */
  onClear?:()=>void;
  selectedFiles?:File[];
};
/** Compact file picker. Selection and persisted attachment state are kept separate. */
export const FileUpload=forwardRef<HTMLInputElement,Props>(function FileUpload({id,attachments,onRemoveAttachment,onClear,selectedFiles,onChange,disabled,multiple,className='',...props},forwardedRef){
 const generated=useId(),input=useRef<HTMLInputElement|null>(null),[chosen,setChosen]=useState<File[]>([]);
 const pickerId=id??`upload-${generated}`;
 const selected=selectedFiles??chosen;
 const savedNames=new Set(attachments?.map(f=>f.filename)??[]);
 const pending=selected.filter(f=>!savedNames.has(f.name));
 function clearSelection(index:number){
  const remaining=selected.filter((_,i)=>i!==index),node=input.current;
  if(!node)return;
  const transfer=new DataTransfer();remaining.forEach(file=>transfer.items.add(file));node.files=transfer.files;
  setChosen(remaining);
  // Consumers already use native file input change handlers; preserve that contract.
  onChange?.({target:node,currentTarget:node} as ChangeEvent<HTMLInputElement>);
  if(!remaining.length)onClear?.();
 }
 return <div className={`pz-file-upload ${className}`}>
  <input {...props} id={pickerId} type="file" multiple={multiple} disabled={disabled} className="pz-file-upload__input"
   ref={node=>{input.current=node;if(typeof forwardedRef==='function')forwardedRef(node);else if(forwardedRef)forwardedRef.current=node;}}
   onChange={event=>{const files=Array.from(event.target.files??[]);if(!files.length)return;setChosen(files);onChange?.(event);}}/>
  <Button variant="neutral" className="pz-file-upload__choose" disabled={disabled} aria-controls={pickerId} onClick={()=>input.current?.click()}>Choose {multiple?'files':'file'}</Button>
  <div className="pz-file-upload__files" aria-live="polite">
   {attachments?.map(file=><span className="pz-file-upload__file" key={file.id} title={file.filename}>
    {file.url?<a className="pz-file-upload__name" href={file.url} target="_blank" rel="noreferrer">{file.filename}</a>:<span className="pz-file-upload__name">{file.filename}</span>}
    {onRemoveAttachment&&<Button variant="neutral" className="pz-file-upload__remove" disabled={disabled} aria-label={`Remove ${file.filename}`} onClick={()=>{setChosen(old=>old.filter(f=>f.name!==file.filename));if(input.current)input.current.value='';void onRemoveAttachment(file);}}>×</Button>}
   </span>)}
   {pending.map((file,index)=><span className="pz-file-upload__file" key={`${file.name}-${file.lastModified}-${index}`} title={file.name}>
    <span className="pz-file-upload__name">{file.name}</span><Button variant="neutral" className="pz-file-upload__remove" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={()=>clearSelection(selected.indexOf(file))}>×</Button>
   </span>)}
   {!pending.length&&!attachments?.length&&<span className="pz-file-upload__empty">No file chosen</span>}
  </div>
 </div>;
});
