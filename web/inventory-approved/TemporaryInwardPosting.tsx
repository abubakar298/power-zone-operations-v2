import React, { useRef, useState } from 'react';
import { api, type Session } from '../api.js';
import { Button } from '../ui/Button.js';

type Line = { itemId: string; quantity: string; unit: string; before: string; after: string };
export type InwardPosting = { number: string; warehouse: string; receivedOn: string; reference: string; lines: Line[] };
type Review = {
  version: number; source: string; authorityVersion: number; reference: string;
  lines: (Line & { key: string; description: string; revision: number | null })[];
};

export function TemporaryInwardPosting({ id, number, warehouse, date, session, onPosted }: {
  id: string; number: string; warehouse: string; date: string; session: Session;
  onPosted: (posting: InwardPosting) => void;
}) {
  const [review, setReview] = useState<Review>();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLSpanElement>(null);
  const endpoint = `/material-dispatches/temporary-documents/${id}/stock-posting`;
  const needsOpening = review?.lines.some(line => line.revision === null);
  const management = ['Admin', 'Management'].includes(session.user.role);

  async function open() {
    setError('');
    setConfirmed(false);
    setReview(undefined);
    dialog.current?.showModal();
    setBusy(true);
    try {
      const data = await api<Review | { posted: InwardPosting }>(endpoint);
      if ('posted' in data) {
        dialog.current?.close();
        onPosted(data.posted);
      }
      else setReview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the warehouse balance.');
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (!review || busy) return;
    setBusy(true);
    setError('');
    try {
      const posted = await api<InwardPosting>(endpoint, {
        csrf: session.csrfToken,
        body: {
          version: review.version, source: review.source, authorityVersion: review.authorityVersion,
          revisions: Object.fromEntries(review.lines.map(line => [line.key, line.revision])),
          confirmZeroOpening: confirmed,
        },
      });
      dialog.current?.close();
      onPosted(posted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the inward.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <span ref={opener}><Button variant="secondary" onClick={() => void open()}>Post to Stock</Button></span>
    <dialog ref={dialog} className="material-document-dialog warehouse-movement-dialog"
      aria-label="Review warehouse inward" onCancel={event => { if (busy) event.preventDefault(); }}
      onClose={() => opener.current?.querySelector('button')?.focus()}>
      <div className="pz-panel pz-stack">
        <h3>Review warehouse inward</h3>
        <p>{number} · {warehouse} · {date}</p>
        {busy && !review && <p role="status">Checking the warehouse balance…</p>}
        {review && <>
          <p>Receiving reference {review.reference}</p>
          <div className="pz-table-scroll">
            <table className="ob-table temporary-lines-table">
              <thead><tr><th>SR#</th><th>Item</th><th>Unit</th><th>Before</th><th>Received</th><th>After</th></tr></thead>
              <tbody>{review.lines.map((line, index) => <tr key={line.key}>
                <td>{index + 1}</td>
                <td><strong>{line.itemId}</strong><div>{line.description}</div></td>
                <td>{line.unit}</td>
                <td>{line.revision === null ? 'No reviewed balance' : line.before}</td>
                <td>{line.quantity}</td>
                <td>{line.revision === null && !confirmed ? 'Pending confirmation' : line.after}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {needsOpening && (management
            ? <label><input type="checkbox" checked={confirmed}
                onChange={event => setConfirmed(event.target.checked)}/>
              {' '}I verified there was zero stock before this receipt for each item without a reviewed balance.
            </label>
            : <p>Management must confirm the opening quantity for items without a reviewed balance.</p>)}
        </>}
        <div className="temporary-document-actions">
          <Button autoFocus variant="neutral" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</Button>
          <Button variant="primary" loading={busy && Boolean(review)} loadingLabel="Posting stock…"
            disabled={busy || !review || Boolean(needsOpening && (!management || !confirmed))}
            onClick={() => void post()}>Confirm &amp; Post to Stock</Button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    </dialog>
  </>;
}
