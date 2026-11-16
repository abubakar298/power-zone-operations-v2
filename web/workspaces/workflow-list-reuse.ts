import {api} from '../api.js';

// Fix 5 (16 Nov 2026). The Design/Coordination sidebar and page used to request the same full
// project list at the same moment, and every page opening downloaded all customers and sites again.

const inFlight = new Map<string, Promise<any>>();

/** Requests with the same key that start while one is still on its way share it. A finished
 * result is never reused, so lists stay as fresh as before. */
export function shareInFlight<T>(key: string, start: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const request = start().finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

/** The department project list; the page's first load and the sidebar share one request. */
export function sharedDepartmentList<T = any>(department: string, scope: string): Promise<T> {
  return shareInFlight(`${department}|${scope}`, () => api<T>(`/project-workflow?department=${department}&scope=${scope}`));
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
