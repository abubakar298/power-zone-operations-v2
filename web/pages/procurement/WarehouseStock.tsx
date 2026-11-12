import { useEffect, useRef, useState, type FormEvent } from "react";
import { Decimal } from "decimal.js";
import { api, ApiError, type Session } from "../../api.js";
import { decimalDisplay } from "../../numbers.js";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";
import { ListPagination, paginateRows, useListPage } from "../../ui/ListPagination.js";
import { fmtDay, type RequestDetail } from "./types.js";

interface Reservation {
  ipoId: string;
  ipoNumber: string;
  customer: string | null;
  site: string | null;
  warehouse: string | null;
  itemId: string | null;
  itemKey: string;
  unit: string;
  quantity: string;
  sharedDispatchPending: boolean;
  expectedUseDate: string | null;
}
interface Incoming {
  reference: string;
  request_number: string;
  supplier: string | null;
  expected: string | null;
  quantity: string;
  unit: string;
  item_key: string;
  warehouse: string;
}
interface StockRow {
  itemId: string;
  description: string;
  warehouse: string;
  unit: string;
  category: string | null;
  onHand: string | null;
  minimum: string | null;
  reserved: string;
  afterReservations: string | null;
  reservationDetails: Reservation[];
  incoming: Incoming[];
  referenceOnly: boolean;
  purchaseItem: { itemKey: string; unit: string } | null;
  purchaseHold: string | null;
}
interface WarehouseStockData {
  warehouses: string[];
  rows: StockRow[];
  reservations: Reservation[];
  unlinkedReservations: Reservation[];
  unlinkedIncoming: Incoming[];
  canCreateRequest: boolean;
}
const stockKey = (row: StockRow) => JSON.stringify([row.warehouse, row.itemId, row.unit]);
const displayed = (value: string | null) => value == null ? "Not available" : decimalDisplay(value, 2);
const orderQuantity = (row: StockRow) => row.incoming.reduce((sum, order) => sum.plus(order.quantity), new Decimal(0)).toString();
const shortage = (row: StockRow) => row.minimum == null || row.afterReservations == null
  ? null : new Decimal(row.minimum).minus(row.afterReservations);
const quantityPattern = /^\d{1,14}(?:\.\d{1,4})?$/;

export function ProcurementWarehouseStock({ session, onCreated, createRequested }: {
  session: Session; onCreated: (id: string) => void; createRequested: number;
}) {
  const [data, setData] = useState<WarehouseStockData>();
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("ascending");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [destination, setDestination] = useState("");
  const [itemToAdd, setItemToAdd] = useState("");
  const [details, setDetails] = useState<{ row: StockRow; kind: "reserved" | "incoming" } | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [pauseRestocking, setPauseRestocking] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const restockingRef = useRef<HTMLDivElement>(null);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const savedAttempt = useRef<{ body: string; key: string } | null>(null);
  const filters = JSON.stringify([query, warehouse, category, sort]);
  const [page, setPage] = useListPage(filters);
  useEffect(() => {
    if (createRequested) {
      setSaveError("");
      setReview(true);
    }
  }, [createRequested]);
  useEffect(() => {
    if (details && !detailsDialog.current?.open) detailsDialog.current?.showModal();
  }, [details]);
  useEffect(() => {
    const viewport = restockingRef.current;
    const table = viewport?.querySelector("table");
    const rows = table?.tBodies[0]?.rows;
    const firstRepeat = table?.tBodies[1]?.rows[0];
    if (!viewport || !table || !rows || !firstRepeat) return;
    const fitFive = () => {
      const rowHeight = rows[4].offsetTop + rows[4].offsetHeight - rows[0].offsetTop;
      viewport.style.maxHeight = `${(table.tHead?.offsetHeight ?? 0) + rowHeight}px`;
    };
    fitFive();
    const observer = new ResizeObserver(fitFive);
    observer.observe(table);
    let frame: number;
    let lastTime: number | null = null;
    let position = viewport.scrollTop;
    let previous = position;
    function advance(now: number) {
      if (!viewport || !rows || !firstRepeat) return;
      const step = lastTime == null ? 0 : Math.min(now - lastTime, 50) * 0.024;
      lastTime = now;
      if (viewport.scrollTop !== previous) position = viewport.scrollTop;
      const cycle = firstRepeat.offsetTop - rows[0].offsetTop;
      if (cycle > 0 && !pauseRestocking && !document.hidden && !viewport.matches(":hover, :focus-within")) {
        position = (position + step) % cycle;
        viewport.scrollTop = position;
        previous = viewport.scrollTop;
      }
      frame = requestAnimationFrame(advance);
    }
    if (!pauseRestocking) frame = requestAnimationFrame(advance);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      viewport.style.maxHeight = "";
    };
  }, [data, filters, pauseRestocking, review]);

  useEffect(() => {
    let active = true;
    api<WarehouseStockData>("/procurement/warehouse-stock").then(result => {
      if (active) setData(result);
    }).catch(error => {
      if (active) setLoadError(error instanceof ApiError ? error.message : "Unable to load warehouse stock.");
    });
    return () => { active = false; };
  }, []);

  const stockHeading = <div className="procurement-page-head"><div>
    <h1>Stock overview</h1><p>Review stock, upcoming orders and Operations reservations by warehouse.</p>
  </div></div>;
  if (loadError) return <>{stockHeading}<p role="alert">{loadError}</p></>;
  if (!data) return <>{stockHeading}<p role="status">Loading warehouse stock…</p></>;

  const categories = [...new Set(data.rows.flatMap(row => row.category ? [row.category] : []))].sort();
  const visible = data.rows.filter(row =>
    (!warehouse || row.warehouse === warehouse) && (!category || row.category === category) &&
    `${row.itemId} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  ).sort((a, b) => {
    const left = sort.startsWith("hand-") ? a.onHand : a.afterReservations;
    const right = sort.startsWith("hand-") ? b.onHand : b.afterReservations;
    if (sort !== "category" && left !== right) {
      if (left == null) return 1;
      if (right == null) return -1;
      const order = new Decimal(left).cmp(right);
      if (order) return sort === "ascending" || sort === "hand-asc" ? order : -order;
    }
    return (a.category ?? "").localeCompare(b.category ?? "") || a.itemId.localeCompare(b.itemId)
      || a.warehouse.localeCompare(b.warehouse) || a.unit.localeCompare(b.unit);
  });
  const selected = data.rows.filter(row => Object.hasOwn(picks, stockKey(row)));
  const receivingWarehouse = selected[0]?.warehouse ?? destination;
  const addable = data.rows.filter(row => row.warehouse === receivingWarehouse && row.purchaseItem && !Object.hasOwn(picks, stockKey(row)));
  const incomingCount = new Set([...data.rows.flatMap(row => row.incoming), ...data.unlinkedIncoming].map(order => order.request_number)).size;
  const pagination = paginateRows(visible, page);
  const unassigned = data.reservations.filter(row => row.warehouse == null);
  const unlinkedReservations = data.unlinkedReservations.filter(row => !warehouse || row.warehouse === warehouse);
  const unlinkedIncoming = data.unlinkedIncoming.filter(row => !warehouse || row.warehouse === warehouse);
  const shortages = visible.filter(row => shortage(row)?.gt(0));
  function pick(row: StockRow, checked: boolean, suggested = "") {
    if (checked && (!row.purchaseItem || selected.length && row.warehouse !== receivingWarehouse)) return;
    setPicks(previous => {
      const key = stockKey(row);
      const next = { ...previous };
      if (checked) next[key] = previous[key] || suggested;
      else delete next[key];
      return next;
    });
  }
  function showDetails(row: StockRow, kind: "reserved" | "incoming") {
    setDetails({ row, kind });
  }
  function rowActions(row: StockRow, suggested = "", repeated = false) {
    const selectedHere = Object.hasOwn(picks, stockKey(row));
    const blocked = !row.purchaseItem || Boolean(selected.length && row.warehouse !== receivingWarehouse);
    return <>
      <div className="procurement-row-actions">
        <label className="pr-warehouse-select"><input type="checkbox" checked={selectedHere} disabled={blocked}
          aria-label={`Select ${row.itemId} (${row.unit}) at ${row.warehouse}`} tabIndex={repeated ? -1 : undefined}
          onChange={event => pick(row, event.target.checked, suggested)} /></label>
        <Button className="procurement-row-link" disabled={blocked} tabIndex={repeated ? -1 : undefined} onClick={() => {
          pick(row, true, suggested);
          setSaveError("");
          setReview(true);
        }}>Add to request</Button>
      </div>
      {row.purchaseHold ? <small>{row.purchaseHold}</small> : blocked && <small>Selected request goes to {receivingWarehouse}</small>}
    </>;
  }

  function restockRow(row: StockRow, index: number, repeated = false) {
    const difference = shortage(row)!.toDecimalPlaces(4).toString();
    const order = row.incoming[0];
    return <tr key={stockKey(row)}>
      <td>{index + 1}</td><td><strong>{row.itemId}</strong><small>{row.description}</small></td><td>{row.warehouse}</td>
      <td className="num">{displayed(row.afterReservations)} {row.unit}</td>
      <td className="num">{displayed(row.minimum)} {row.unit}</td>
      <td className="num procurement-shortage">{displayed(difference)} {row.unit}</td>
      <td>{order ? <><strong>{displayed(order.quantity)} {order.unit}</strong>
        <small>{order.expected ? fmtDay(order.expected) : "Date unassigned"}</small>
        <small>{order.reference || order.request_number}</small></> : "No open orders"}</td>
      <td>{rowActions(row, difference, repeated)}</td>
    </tr>;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !data?.canCreateRequest) return;
    const lines = selected.map(row => ({ itemId: row.itemId, unit: row.unit, quantity: picks[stockKey(row)].trim() }));
    if (!title.trim() || !lines.length || lines.some(line => !quantityPattern.test(line.quantity) || new Decimal(line.quantity).lte(0))) {
      setSaveError("Enter a title and a positive quantity with up to four decimals for every item.");
      return;
    }
    const body = { title: title.trim(), warehouse: receivingWarehouse, lines };
    const signature = JSON.stringify(body);
    if (savedAttempt.current?.body !== signature) savedAttempt.current = { body: signature, key: crypto.randomUUID() };
    setBusy(true);
    setSaveError("");
    try {
      const draft = await api<RequestDetail>("/procurement/requests/from-warehouse", {
        body: { ...body, requestKey: savedAttempt.current.key }, csrf: session.csrfToken,
      });
      onCreated(draft.id);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : "Unable to create the purchase request.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="procurement-stock-panels">
    {review ? <>
    <div className="procurement-page-head"><div><h1>{selected.length ? "Add selected items" : "Create request"}</h1>
      <p>Review stock and enter the quantity to buy for each item.</p></div>
      <Button disabled={busy} onClick={() => setReview(false)}>Back to stock overview</Button>
    </div>
    <form className="pz-panel pz-stack" onSubmit={create}>
      <Field id="procurement-warehouse-draft-title" label="Request title (required)">
        <input id="procurement-warehouse-draft-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required />
      </Field>
      <div className="pz-form-grid">
        <Field id="procurement-draft-warehouse" label="Receiving warehouse (required)">
          <select id="procurement-draft-warehouse" value={receivingWarehouse} disabled={Boolean(selected.length)} required
            onChange={event => { setDestination(event.target.value); setItemToAdd(""); }}>
            <option value="">Choose warehouse</option>{data.warehouses.map(name => <option key={name}>{name}</option>)}
          </select>
        </Field>
        <Field id="procurement-add-item" label="Item ID">
          <select id="procurement-add-item" value={itemToAdd} disabled={!receivingWarehouse} onChange={event => setItemToAdd(event.target.value)}>
            <option value="">Select an item ID</option>{addable.map(row => <option key={stockKey(row)} value={stockKey(row)}>{row.itemId} · {row.description} ({row.unit})</option>)}
          </select>
        </Field>
      </div>
      <div><Button variant="secondary" disabled={!itemToAdd} onClick={() => {
        const row = addable.find(candidate => stockKey(candidate) === itemToAdd);
        if (row) pick(row, true);
        setItemToAdd("");
      }}>Add item</Button></div>
      <div className="pz-table-scroll">
        <table className="ops-table">
          <thead><tr><th>SR#</th><th>Item ID / description</th><th>Warehouse</th><th className="num">On hand</th><th className="num">After reservations</th><th>Quantity to buy</th><th>Action</th></tr></thead>
          <tbody>{selected.map((row, index) => {
            const key = stockKey(row);
            return <tr key={key}>
              <td>{index + 1}</td><td><strong>{row.itemId}</strong><small>{row.description}</small></td>
              <td>{row.warehouse}<small>{row.unit}</small></td><td className="num">{displayed(row.onHand)}</td>
              <td className="num">{displayed(row.afterReservations)}</td><td><input aria-label={`Quantity for ${row.itemId} (${row.unit})`} inputMode="decimal" value={picks[key]}
                onChange={event => setPicks(previous => ({ ...previous, [key]: event.target.value }))} required /></td>
              <td><Button className="procurement-row-link" onClick={() => pick(row, false)}>Remove</Button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="pz-action-row">
        <Button variant="primary" type="submit" loading={busy} disabled={!selected.length || !data.canCreateRequest}>Create purchase request</Button>
        {!data.canCreateRequest && <span>Only the Procurement buyer can save a request.</span>}
      </div>
      {saveError && <p role="alert">{saveError}</p>}
    </form></> : <>
      {stockHeading}
      <div className="procurement-stock-summary">
        <div><small>Inventory item IDs</small><strong>{new Set(data.rows.map(row => row.itemId)).size}</strong></div>
        <div><small>Item lines with reservations</small><strong>{new Set(data.reservations.map(row => row.itemId ?? row.itemKey)).size}</strong></div>
        <div><small>Open incoming orders</small><strong>{incomingCount}</strong></div>
      </div>
      <div className="pz-panel procurement-stock-toolbar">
        <Field id="procurement-stock-find" label="Find an item">
          <input id="procurement-stock-find" type="search" placeholder="Item ID or description" value={query} onChange={event => setQuery(event.target.value)} />
        </Field>
        <Field id="procurement-stock-warehouse" label="Warehouse">
          <select id="procurement-stock-warehouse" value={warehouse} onChange={event => setWarehouse(event.target.value)}>
            <option value="">All warehouses</option>{data.warehouses.map(name => <option key={name}>{name}</option>)}
          </select>
        </Field>
        <Field id="procurement-stock-category" label="Category">
          <select id="procurement-stock-category" value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">All categories</option>{categories.map(name => <option key={name}>{name}</option>)}
          </select>
        </Field>
        <Field id="procurement-stock-sort" label="Sort by">
          <select id="procurement-stock-sort" value={sort} onChange={event => setSort(event.target.value)}>
            <option value="category">Category and item ID</option><option value="ascending">After reserve · low to high</option><option value="descending">After reserve · high to low</option>
            <option value="hand-asc">On hand · low to high</option><option value="hand-desc">On hand · high to low</option>
          </select>
        </Field>
      </div>
      <div className="pz-panel procurement-selection-bar">
        <span role="status">{selected.length} selected</span>
        <Button variant="primary" disabled={!selected.length} onClick={() => { setSaveError(""); setReview(true); }}>Add selected to request</Button>
        <Button disabled={!selected.length} onClick={() => { setPicks({}); setItemToAdd(""); }}>Clear selection</Button>
        {selected.length > 0 && <small>Receiving warehouse · {receivingWarehouse}</small>}
      </div>
      <section className="pz-panel pz-stack">
        <div className="procurement-panel-head">
          <h2>Needs restocking</h2>
          <div className="procurement-panel-tools"><small className="procurement-shortage-count">{shortages.length} shortages</small>
          {shortages.length > 5 && <Button variant="neutral" onClick={() => setPauseRestocking(paused => !paused)}>
            {pauseRestocking ? "Resume scrolling" : "Pause scrolling"}
          </Button>}</div>
        </div>
        {shortages.length ? <div className="pz-table-scroll pr-warehouse-shortages" ref={restockingRef} role="region" aria-label="Restocking shortages" tabIndex={0}>
          <table className="ops-table procurement-stock-table">
            <thead><tr><th>SR#</th><th>Item ID / description</th><th>Warehouse</th><th className="num">After reservations</th>
              <th className="num">Minimum</th><th className="num">Short by</th><th>Incoming stock</th><th>Action</th></tr></thead>
            <tbody>{shortages.map((row, index) => restockRow(row, index))}</tbody>
            {shortages.length > 5 && <tbody className="pr-restock-repeat" aria-hidden="true">
              {shortages.slice(0, 5).map((row, index) => restockRow(row, index, true))}
            </tbody>}
          </table>
        </div> : <p>No shortages match these filters.</p>}
      </section>
      {unassigned.length > 0 && <details>
        <summary>Warehouse unassigned · {unassigned.length} reservation {unassigned.length === 1 ? "line" : "lines"}</summary>
        <ReservationTable rows={unassigned} />
      </details>}
      {unlinkedReservations.length > 0 && <details>
        <summary>Reservations that need an Inventory link · {unlinkedReservations.length}</summary>
        <ReservationTable rows={unlinkedReservations} showWarehouse />
      </details>}
      {unlinkedIncoming.length > 0 && <details>
        <summary>Incoming order lines that need a warehouse or Inventory link · {unlinkedIncoming.length}</summary>
        <IncomingTable rows={unlinkedIncoming} showWarehouse />
      </details>}
      {details && <dialog ref={detailsDialog} className="procurement-stock-dialog" onClose={() => setDetails(null)}>
        <div className="pz-action-row"><h3>{details.kind === "reserved" ? "IPO reservations" : "Incoming orders"} · {details.row.itemId}</h3>
          <Button variant="neutral" onClick={() => detailsDialog.current?.close()}>Close details</Button></div>
        {details.kind === "reserved" ? <ReservationTable rows={details.row.reservationDetails} /> : <IncomingTable rows={details.row.incoming} />}
      </dialog>}
      <section className="pz-panel pz-stack">
      <div className="procurement-panel-head"><h2>Inventory catalogue</h2><small>{visible.length} stock lines</small></div>
      <div className="pz-table-scroll">
        <table className="ops-table procurement-stock-table">
          <thead><tr><th>SR#</th><th>Item ID / description</th><th>Warehouse</th><th>Unit</th><th className="num">On hand</th>
            <th className="num">Incoming</th><th className="num">Reserved</th><th className="num">After reservations</th><th className="num">Minimum</th><th>Action</th></tr></thead>
          <tbody>{pagination.rows.length ? pagination.rows.map((row, index) => {
            const key = stockKey(row);
            return <tr key={key}>
              <td>{pagination.start + index + 1}</td><td><strong>{row.itemId}</strong><small>{row.description}</small>{row.category && <small>{row.category}</small>}</td>
              <td>{row.warehouse}</td><td>{row.unit}</td>
              <td className="num">{displayed(row.onHand)}{row.referenceOnly && <small>Reference balance</small>}</td>
              <td className="num">{row.incoming.length > 0 ? <Button className="procurement-row-link" onClick={() => showDetails(row, "incoming")}>{displayed(orderQuantity(row))}</Button> : "—"}</td>
              <td className="num">{row.reservationDetails.length ? <Button className="procurement-row-link" onClick={() => showDetails(row, "reserved")}>{displayed(row.reserved)}</Button> : displayed(row.reserved)}
                {row.reservationDetails.some(reservation => reservation.sharedDispatchPending) && <small>Shared dispatch needs review</small>}</td>
              <td className="num">{displayed(row.afterReservations)}</td>
              <td className="num">{displayed(row.minimum)}</td>
              <td>{rowActions(row)}</td>
            </tr>;
          }) : <tr><td colSpan={10}>No warehouse stock matches these filters.</td></tr>}</tbody>
        </table>
      </div>
      <ListPagination pagination={pagination} onPageChange={setPage} label="stock rows" />
      </section>
    </>}
  </div>;
}

function IncomingTable({ rows, showWarehouse = false }: { rows: Incoming[]; showWarehouse?: boolean }) {
  return <div className="pz-table-scroll">
    <table className="ops-table">
      <thead><tr><th>SR#</th><th>Order / supplier</th>{showWarehouse && <><th>Item ID</th><th>Delivery destination</th></>}
        <th className="num">Still due</th><th>Expected arrival</th></tr></thead>
      <tbody>{rows.map((order, index) => <tr key={JSON.stringify([order.request_number, order.item_key])}>
        <td>{index + 1}</td><td><strong>{order.reference || order.request_number}</strong><small>{order.supplier || "Supplier unassigned"}</small></td>
        {showWarehouse && <><td>{order.item_key}</td><td>{order.warehouse || "Warehouse unassigned"}</td></>}
        <td className="num">{displayed(order.quantity)} {order.unit}</td><td>{order.expected ? fmtDay(order.expected) : "Date unassigned"}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function ReservationTable({ rows, showWarehouse = false }: { rows: Reservation[]; showWarehouse?: boolean }) {
  return <div className="pz-table-scroll">
    <table className="ops-table">
      <thead><tr><th>SR#</th><th>IPO / site</th><th>Customer</th><th>Item ID</th>{showWarehouse && <th>Warehouse</th>}<th className="num">Reserved</th><th>Expected use date</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={JSON.stringify([row.ipoId, row.itemKey, row.unit])}>
        <td>{index + 1}</td><td><strong>{row.ipoNumber}</strong>{row.site && <small>{row.site}</small>}</td>
        <td>{row.customer || "Customer not recorded"}</td><td>{row.itemId || row.itemKey}{!row.itemId && <small>Inventory link needs review</small>}</td>
        {showWarehouse && <td>{row.warehouse}</td>}
        <td className="num">{displayed(row.quantity)} {row.unit}{row.sharedDispatchPending && <small>Shared dispatch needs review</small>}</td>
        <td>{row.expectedUseDate ? fmtDay(row.expectedUseDate) : "Not yet planned"}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
