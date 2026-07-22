// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/** Shared UI primitives: modals, toasts, the drop zone, output delivery. */

const MODAL_OPEN_CLASS = 'is-open';

export function initModals(): void {
  const openers = document.querySelectorAll<HTMLElement>('[data-modal-open]');
  openers.forEach((opener) => {
    opener.addEventListener('click', () => openModal(opener.dataset.modalOpen ?? '', opener));
  });

  document.querySelectorAll<HTMLElement>('.modal').forEach((modal) => {
    modal.querySelectorAll<HTMLElement>('[data-modal-close]').forEach((closer) => {
      closer.addEventListener('click', () => closeModal(modal));
    });
    // Only a press that both starts and ends on the backdrop counts, so a
    // selection dragged out of the panel does not dismiss it.
    let pressedOnBackdrop = false;
    modal.addEventListener('mousedown', (event) => {
      pressedOnBackdrop = event.target === modal;
    });
    modal.addEventListener('click', (event) => {
      if (pressedOnBackdrop && event.target === modal) closeModal(modal);
      pressedOnBackdrop = false;
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = document.querySelector<HTMLElement>(`.modal.${MODAL_OPEN_CLASS}`);
    if (open) closeModal(open);
  });
}

let lastFocused: HTMLElement | null = null;

export function openModal(id: string, opener?: HTMLElement): void {
  const modal = document.getElementById(id);
  if (!modal) return;
  lastFocused = opener ?? (document.activeElement as HTMLElement | null);
  modal.classList.add(MODAL_OPEN_CLASS);
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector<HTMLElement>('[data-modal-close]')?.focus();
}

export function closeModal(modal: HTMLElement): void {
  modal.classList.remove(MODAL_OPEN_CLASS);
  modal.setAttribute('aria-hidden', 'true');
  lastFocused?.focus?.({ preventScroll: true });
  lastFocused = null;
}

let toastTimer: number | undefined;

export function toast(message: string, tone: 'info' | 'bad' = 'info'): void {
  const host = document.getElementById('toast');
  if (!host) return;
  host.textContent = message;
  host.dataset.tone = tone;
  host.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => host.classList.remove('is-visible'), 3600);
}

export interface DropZoneOptions {
  zone: HTMLElement;
  input: HTMLInputElement;
  onFile: (file: File) => void;
}

/**
 * Drag-drop, tap-to-pick and keyboard, wired to one callback.
 *
 * The dragover counter matters: dragging across a child element fires
 * `dragleave` on the parent, so a naive boolean flickers the highlight off
 * while the pointer is still very much inside the zone.
 */
export function initDropZone({ zone, input, onFile }: DropZoneOptions): void {
  let depth = 0;

  const setActive = (active: boolean) => zone.classList.toggle('is-dragover', active);

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onFile(file);
    // Reset so picking the same file twice in a row still fires `change`.
    input.value = '';
  });

  zone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    depth++;
    setActive(true);
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  zone.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) setActive(false);
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    setActive(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });

  // Dropping anywhere else must not make the browser navigate away from an
  // unsaved session and open the raw file instead.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously cancels the download in Safari; one turn is enough.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function canShareFile(file: File): boolean {
  return typeof navigator.share === 'function' && (navigator.canShare?.({ files: [file] }) ?? false);
}

export async function shareFile(file: File): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title: file.name });
    return true;
  } catch (error) {
    // An AbortError is the user closing the sheet — not a failure worth
    // reporting back to them as one.
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Anything thrown anywhere in the app becomes a sentence a person can read. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    // DuckDB prefixes its parse errors with the exception class, which is noise
    // in a UI. Everything after the first colon is the part that helps.
    const cleaned = message.replace(/^(Invalid|Binder|Parser|Catalog|Conversion|IO|Out of Memory)\s+Error:\s*/i, '');
    return cleaned || message || 'Something went wrong.';
  }
  return typeof error === 'string' && error.trim() ? error : 'Something went wrong.';
}
