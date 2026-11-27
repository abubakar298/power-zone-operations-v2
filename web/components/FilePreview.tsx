import {useState} from 'react';
import {AccountsRecordDialog} from './AccountsRecordDialog.js';
import {DocumentPreview} from './AccountsDocumentPreview.js';
import {DocumentDownload} from './DocumentPreview.js';
import {Button} from '../ui/Button.js';
import '../ui/accounts.css';
import './evidence-preview.css';

// The in-page viewer draws PDFs and these images. Other types are offered as a download only.
const imageTypes=['image/png','image/jpeg','image/webp','image/gif'];
const imageExtensions=['png','jpg','jpeg','webp','gif'];
export function canPreview(name:string,type=''){
 const media=type.toLowerCase();
 if(media==='application/pdf'||imageTypes.includes(media))return true;
 if(media&&media!=='application/octet-stream')return false;
 const extension=/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
 return extension==='pdf'||!!extension&&imageExtensions.includes(extension);
}

/** Preview of a file the user has chosen but not uploaded yet, so they can check it is the right one.
 * The file is only read for drawing; the bytes that are uploaded are the same file, unchanged. */
export function ChosenFilePreview({file,label='Preview'}:{file:File;label?:string}){
 const [open,setOpen]=useState(false);
 if(!canPreview(file.name,file.type))return <small className="pz-file-actions__note">No preview for this file type</small>;
 return <><Button variant="neutral" aria-label={`${label}: ${file.name}`} onClick={()=>setOpen(true)}>{label}</Button>{open&&<AccountsRecordDialog title={file.name} subtitle="Chosen file · not uploaded yet" onClose={()=>setOpen(false)}><DocumentPreview url={'chosen-file:'+file.name} title={file.name} data={file} showDownload={false} compactControls/></AccountsRecordDialog>}</>;
}

/** Preview of a saved file inside the page, next to its own Download button.
 * Without a known type or file name the viewer tries the file and says plainly when it cannot draw it. */
export function StoredFileActions({url,title,filename,mediaType,previewLabel='Preview',downloadLabel='Download'}:{url:string;title:string;filename?:string;mediaType?:string;previewLabel?:string;downloadLabel?:string}){
 const [open,setOpen]=useState(false);
 const previewable=!mediaType&&!filename||canPreview(filename??title,mediaType);
 return <div className="pz-file-actions">{previewable?<Button variant="secondary" aria-label={`${previewLabel}: ${title}`} onClick={()=>setOpen(true)}>{previewLabel}</Button>:<small className="pz-file-actions__note">No preview for this file type · use Download</small>}<DocumentDownload url={url} title={title} label={downloadLabel} downloadFilename={filename}/>{open&&<AccountsRecordDialog title={title} onClose={()=>setOpen(false)}><DocumentPreview url={url} title={title} downloadFilename={filename} compactControls/></AccountsRecordDialog>}</div>;
}
