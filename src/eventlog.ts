/**
 * The event log drawer.
 *
 * For a tool whose entire value proposition is "this never leaves your device",
 * a visible, timestamped account of what actually happened is worth more than
 * any reassuring paragraph — and it's the only output we produce anywhere.
 */

import { formatTimestamp } from './format';
import type { LogLevel } from './types';

const MAX_ENTRIES = 300;

export class EventLog {
  private list: HTMLUListElement;
  private drawer: HTMLElement;
  private toggle: HTMLButtonElement;
  private countBadge: HTMLElement;
  private count = 0;

  constructor(drawer: HTMLElement, toggle: HTMLButtonElement) {
    this.drawer = drawer;
    this.toggle = toggle;
    this.list = drawer.querySelector('.eventlog-list') as HTMLUListElement;
    this.countBadge = toggle.querySelector('.eventlog-count') as HTMLElement;

    const closeButton = drawer.querySelector('.eventlog-close') as HTMLButtonElement | null;
    closeButton?.addEventListener('click', () => this.close());
    toggle.addEventListener('click', () => this.setOpen(!this.isOpen));

    // The drawer covers the toggle on a phone, so Escape has to work.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen(): boolean {
    return this.drawer.classList.contains('is-open');
  }

  setOpen(open: boolean): void {
    this.drawer.classList.toggle('is-open', open);
    this.drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    this.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  open(): void {
    this.setOpen(true);
  }

  close(): void {
    this.setOpen(false);
  }

  add(level: LogLevel, message: string): void {
    const item = document.createElement('li');
    item.className = `eventlog-item is-${level}`;

    const time = document.createElement('span');
    time.className = 'eventlog-time';
    time.textContent = formatTimestamp(new Date());

    const text = document.createElement('span');
    text.className = 'eventlog-text';
    text.textContent = message;

    item.append(time, text);
    this.list.append(item);

    while (this.list.children.length > MAX_ENTRIES) {
      this.list.firstElementChild?.remove();
    }

    this.list.scrollTop = this.list.scrollHeight;
    this.count++;
    this.countBadge.textContent = String(this.count);
    this.countBadge.hidden = false;
  }
}
