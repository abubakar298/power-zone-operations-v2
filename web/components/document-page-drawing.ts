// Fix 6 (16 Nov 2026): a PDF preview shows page 1 as soon as it is drawn and draws the other pages only
// when they come near the visible part of the preview, instead of drawing every page before showing
// anything. Pages stay PNG data pictures as before (the site's security rules allow data: images, not blob:).
// Screens that need every page drawn (Survey Dispatch prints the drawn pages) pass drawAll.

export const previewScale = 1.25;
/** Pages this close below (or above) the visible area are drawn before the user reaches them. */
export const nearbyMargin = '800px 0px';
/** A blank stand-in shown until a page is drawn (an image with no picture shows a "broken" icon). */
const blankPage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

type PdfPage = {
  getViewport(options: {scale: number}): {width: number; height: number};
  render(options: Record<string, unknown>): {promise: Promise<unknown>};
  cleanup?: () => unknown;
};
export type PdfDocument = {numPages: number; getPage(n: number): Promise<PdfPage>};

export type PdfPagesView = {
  /** Page 1 is drawn (or every page, with drawAll). Rejects if a page cannot be drawn. */
  ready: Promise<void>;
  /** Stops drawing. */
  stop(): void;
};

export async function showPdfPages(doc: PdfDocument, host: HTMLElement, title: string, {drawAll = false}: {drawAll?: boolean} = {}): Promise<PdfPagesView> {
  let stopped = false;
  const images: HTMLImageElement[] = [];
  const pages: PdfPage[] = [];
  // One empty, correctly sized place per page, so scrolling and the scroll bar match the document.
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({scale: previewScale});
    const image = document.createElement('img');
    image.alt = `${title} · page ${n}`;
    image.dataset.page = String(n);
    image.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    image.src = blankPage;
    pages.push(page);
    images.push(image);
  }
  host.append(...images);

  // Pages are drawn one at a time, in the order they are asked for.
  const drawn = new Set<number>();
  let queue = Promise.resolve();
  const draw = (n: number) => {
    if (drawn.has(n)) return Promise.resolve();
    drawn.add(n);
    const job = queue.then(async () => {
      if (stopped) return;
      const page = pages[n - 1];
      const viewport = page.getViewport({scale: previewScale});
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({canvas, canvasContext: canvas.getContext('2d')!, viewport}).promise;
      if (stopped) return;
      images[n - 1].src = canvas.toDataURL('image/png');
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();
      images[n - 1].dataset.drawn = 'true';
    });
    queue = job.catch(() => undefined);
    return job;
  };

  let observer: IntersectionObserver | undefined;
  let ready: Promise<void>;
  if (drawAll || typeof IntersectionObserver === 'undefined') {
    ready = images.reduce<Promise<void>>((previous, _image, index) => previous.then(() => draw(index + 1)), Promise.resolve());
  } else {
    ready = draw(1);
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const n = Number((entry.target as HTMLElement).dataset.page);
        observer?.unobserve(entry.target);
        void draw(n).catch(() => undefined);
      }
    }, {root: host.closest('.ipo-preview-pages'), rootMargin: nearbyMargin});
    for (const image of images.slice(1)) observer.observe(image);
  }

  return {
    ready,
    stop() {
      stopped = true;
      observer?.disconnect();
    },
  };
}
