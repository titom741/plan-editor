/**
 * Captures what a "save to file" action would have downloaded.
 *
 * `downloadProjectFile` works the only way a browser lets you: build a
 * blob URL, click a hidden anchor, revoke the URL. There is no DOM in
 * Node, so this stubs the pieces that path touches and records the
 * filename and the bytes — which is exactly what a test wants to assert.
 */
export interface DownloadCapture {
  /** The name the anchor's `download` attribute carried when it was clicked. */
  fileName: string | null;
  /** The blob handed to `createObjectURL`; `await blob.text()` for the contents. */
  blob: Blob | null;
  /** Blob URLs created and not yet revoked. Anything left here is a real leak. */
  liveUrls: Set<string>;
  restore(): void;
}

export function installDownloadCapture(): DownloadCapture {
  const globals = globalThis as Record<string, unknown>;
  const previousDocument = globals.document;
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;

  const capture: DownloadCapture = {
    fileName: null,
    blob: null,
    liveUrls: new Set<string>(),
    restore: () => {
      globals.document = previousDocument;
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    },
  };

  let counter = 0;
  URL.createObjectURL = (object: Blob | MediaSource) => {
    capture.blob = object as Blob;
    const url = `blob:test/${(counter += 1)}`;
    capture.liveUrls.add(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    capture.liveUrls.delete(url);
  };

  globals.document = {
    body: { appendChild: () => {} },
    // The anchor is configured inside the function under test, so the
    // filename is read back off the element at the moment it is clicked.
    createElement: () => {
      const link = {
        href: "",
        download: "",
        click: () => {
          capture.fileName = link.download;
        },
        remove: () => {},
      };
      return link;
    },
  };

  return capture;
}
