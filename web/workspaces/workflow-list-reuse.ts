import {api} from '../api.js';

// Fix 5 (16 Nov 2026). The Design/Coordination sidebar and page used to request the same full
// project list at the same moment, and every page opening downloaded all customers and sites again.

const inFlight = new Map<string, {request: Promise<any>; leave: boolean}>();
const leftForPage = new Map<string, {at: number; value: unknown}>();
/** How long a list the sidebar just downloaded waits for the page's opening load to take it. */
export const handOffMs = 5_000;

type ShareOptions = {
  /** The sidebar: leave the finished list for the page's opening load (taken once, within handOffMs). */
  leaveForPage?: boolean;
  /** The page's opening load: take a list the sidebar left a moment ago instead of downloading it again. */
  takeLeft?: boolean;
  now?: () => number;
};

/** Requests with the same key that start while one is still on its way share it. Otherwise a finished
 * result is never reused, except the one hand-off from the sidebar to the page's opening load: since
 * the page's code loads separately (PR 87), the sidebar's request can finish just before the page asks. */
export function shareInFlight<T>(key: string, start: () => Promise<T>, {leaveForPage = false, takeLeft = false, now = Date.now}: ShareOptions = {}): Promise<T> {
  if (takeLeft) {
    const left = leftForPage.get(key);
    leftForPage.delete(key);
    if (left && now() - left.at < handOffMs) return Promise.resolve(left.value as T);
  }
  const existing = inFlight.get(key);
  if (existing) {
    // The page joined the sidebar's request: there is nothing left to hand over afterwards.
    if (takeLeft) existing.leave = false;
    return existing.request as Promise<T>;
  }
  const entry = {leave: leaveForPage, request: undefined as unknown as Promise<T>};
  entry.request = start().then(value => {
    if (entry.leave) leftForPage.set(key, {at: now(), value});
    return value;
  }).finally(() => {
    if (inFlight.get(key) === entry) inFlight.delete(key);
  });
  inFlight.set(key, entry);
  return entry.request;
}

/** The department project list; the page's first load and the sidebar share one request. */
export function sharedDepartmentList<T = any>(department: string, scope: string, options: {leaveForPage?: boolean; takeLeft?: boolean} = {}): Promise<T> {
  return shareInFlight(`${department}|${scope}`, () => api<T>(`/project-workflow?department=${department}&scope=${scope}`), options);
}

export const referencesMaxAgeMs = 5 * 60_000;

/** Customers, sites and other reference lists, kept for 5 minutes per account. `fresh` always asks the
 * server (after adding or editing a customer or site) and keeps the answer as the new copy. */
export function createReferencesCache(fetchReferences: () => Promise<any>, now: () => number = Date.now) {
  let copy: {userId: string; at: number; value: Promise<any>} | undefined;
  return {
    get(userId: string, {fresh = false}: {fresh?: boolean} = {}): Promise<any> {
      const time = now();
      if (!fresh && copy && copy.userId === userId && time - copy.at < referencesMaxAgeMs) return copy.value;
      const value = fetchReferences();
      const entry = {userId, at: time, value};
      copy = entry;
      value.catch(() => { if (copy === entry) copy = undefined; });
      return value;
    },
  };
}

const references = createReferencesCache(() => api<any>('/project-workflow/references'));
export function workflowReferences<T = any>(userId: string, options?: {fresh?: boolean}): Promise<T> {
  return references.get(userId, options);
}
