import {displayDateTime} from '../../server/display/dates.js';
import {Button} from '../ui/Button.js';

type Item={id:string;stage:string;title:string;detail:string;at:string|null;url:string|null};
type Stage={stage:string;items:Item[]};

/** Project file: one customer site's records in the order the work happens (survey → invoice).
 * Saved documents open in the existing preview; other files open from their existing download links. */
export function ProjectFileView({stages,onPreview}:{stages:Stage[];onPreview:(id:string)=>boolean}){
 return <section className="pz-stack" aria-label="Project file">
  <h3>Project file</h3>
  <p className="pz-caption">Every record of this site, in work order. Each document is stored once and linked here; nothing is copied.</p>
  {stages.map(({stage,items})=><section key={stage} className="pz-stack" aria-label={stage}>
   <h4>{stage} <span className="pz-caption">({items.length})</span></h4>
   {!items.length?<p className="pz-caption">Nothing recorded yet.</p>:<div className="pz-table-scroll"><table className="pz-table"><thead><tr><th scope="col">SR#</th><th>Record</th><th>Details</th><th>Date</th><th>Open</th></tr></thead><tbody>
    {items.map((item,index)=><tr key={item.id}><td>{index+1}</td><td>{item.title}</td><td>{item.detail}</td><td>{item.at?displayDateTime(item.at):'—'}</td>
     <td>{item.url?<OpenLink item={item} onPreview={onPreview}/>:<span className="pz-caption">—</span>}</td></tr>)}
   </tbody></table></div>}
  </section>)}
 </section>;
}

function OpenLink({item,onPreview}:{item:Item;onPreview:(id:string)=>boolean}){
 return <Button variant="neutral" onClick={()=>{if(!onPreview(item.id))window.open(item.url!,'_blank','noopener');}}>Open</Button>;
}
