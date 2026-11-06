import {HttpError} from '../http/errors.js';

/** Store a reference only. Never fetch media or change Drive sharing. */
export function sitePictureFolder(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) throw new HttpError(422, 'Enter a Google Drive site folder link.');
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new HttpError(422, 'Enter a valid Google Drive site folder link.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password || url.port)
    throw new HttpError(422, 'Use an HTTPS Google Drive site folder link.');
  const id = url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  if (!id) throw new HttpError(422, 'Open the site folder in Google Drive and copy its folder link.');
  return `https://drive.google.com/drive/folders/${id}`;
}
