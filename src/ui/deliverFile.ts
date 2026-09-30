import { getPlanHost, messageOf } from "../persistence/planHost";

/**
 * Hands a generated file — a PDF, an image, a CSV — to whoever keeps files.
 *
 * In a browser that is a download. Inside a host that files things itself
 * (KL-055: Virade, which puts every file of an event in that year's
 * folder), the file goes straight to the host, and the editor says where it
 * went: no dialog, and nothing left behind in « Téléchargements ». If the
 * host refuses, the file is downloaded all the same — an export is never
 * lost to a filing rule.
 */

export const FILE_DELIVERED_EVENT = "plan-editor:file-delivered";

export interface FileDelivered {
  fileName: string;
  /** Where the host put it; `null` for a browser download, which never says. */
  path: string | null;
  error: string | null;
}

function announce(detail: FileDelivered): void {
  window.dispatchEvent(new CustomEvent<FileDelivered>(FILE_DELIVERED_EVENT, { detail }));
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Freed on the next tick rather than immediately: revoking synchronously
  // can cancel the download in some browsers before it has started reading.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // In slices: spreading a whole scan into one call overflows the stack.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

export function deliverFile(blob: Blob, fileName: string): void {
  const host = getPlanHost();
  if (!host?.saveFile) {
    download(blob, fileName);
    return;
  }
  const saveFile = host.saveFile.bind(host);
  void toBase64(blob)
    .then((base64) => saveFile(fileName, base64))
    .then((path) =>
      announce({ fileName, path: typeof path === "string" ? path : null, error: null }),
    )
    .catch((error: unknown) => {
      download(blob, fileName);
      announce({
        fileName,
        path: null,
        error: `${host.name} n'a pas pu ranger « ${fileName} » (${messageOf(error)}) : il a été téléchargé à la place.`,
      });
    });
}
