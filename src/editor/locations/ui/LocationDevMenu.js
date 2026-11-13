import './locationDevMenu.css';

const DIGIT_CODE = /^(?:Digit|Numpad)([0-9])$/;

function isTextEntry(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true;
}

function consume(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function menuRow(key, label, active) {
  const item = document.createElement('li');
  if (active) item.setAttribute('aria-current', 'location');
  const badge = document.createElement('kbd');
  badge.textContent = key;
  const text = document.createElement('span');
  text.textContent = label;
  item.append(badge, text);
  return item;
}

/**
 * Keyboard-driven development menu for opening showcase locations.
 * Works under pointer lock (no mouse needed).
 */
export class LocationDevMenu {
  /**
   * @param {object} options
   * @param {HTMLElement} [options.root=document.body]
   * @param {Array<{id: string, title: string, subtitle?: string}>} options.sites  at most 9
   * @param {(siteId: string) => void} options.onEnter   called when a site is chosen
   * @param {() => void} options.onExit                  called when "leave location" is chosen
   * @param {() => string|null} options.getActiveSiteId  id of the location the player is in, or null
   * @param {string} [options.toggleCode='F8']           KeyboardEvent.code that opens/closes the menu
   */
  constructor({ root = document.body, sites, onEnter, onExit, getActiveSiteId, toggleCode = 'F8' }) {
    this.sites = sites.slice(0, 9);
    this.callbacks = { onEnter, onExit, getActiveSiteId };
    this.toggleCode = toggleCode;

    this.element = document.createElement('div');
    this.element.className = 'location-dev-menu';
    this.element.hidden = true;
    this.element.setAttribute('aria-label', 'Showcase locations');
    this.list = document.createElement('ol');
    const hint = document.createElement('p');
    hint.className = 'location-dev-menu__hint';
    hint.textContent = `${toggleCode} to close · number to travel`;
    this.element.append(this.list, hint);
    root.append(this.element);

    // Capture phase, so the walker's own key handling never sees a menu key.
    this.onKeyDown = (event) => this.#handleKey(event);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen() {
    return !this.element.hidden;
  }

  open() {
    this.#renderRows();
    this.element.hidden = false;
  }

  close() {
    this.element.hidden = true;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.element.remove();
  }

  #handleKey(event) {
    if (isTextEntry(event.target)) return;
    if (event.code === this.toggleCode) {
      consume(event);
      if (event.repeat) return;
      if (this.isOpen) this.close();
      else this.open();
      return;
    }
    if (!this.isOpen) return;
    if (event.code === 'Escape') {
      consume(event);
      this.close();
      return;
    }
    const digit = DIGIT_CODE.exec(event.code)?.[1];
    if (digit === undefined) return;
    // Every digit is the menu's while it is open, so a miss never reaches the game.
    consume(event);
    if (digit === '0') {
      if (this.#activeSiteId() === null) return;
      this.close();
      this.#call('onExit');
      return;
    }
    const site = this.sites[Number(digit) - 1];
    if (!site) return;
    this.close();
    this.#call('onEnter', site.id);
  }

  #activeSiteId() {
    return this.#call('getActiveSiteId') ?? null;
  }

  #call(name, ...args) {
    const fail = (error) => console.error(`LocationDevMenu ${name} failed.`, error);
    try {
      const result = this.callbacks[name]?.(...args);
      // An async callback rejects instead of throwing.
      if (typeof result?.catch === 'function') result.catch(fail);
      return result;
    } catch (error) {
      fail(error);
      return undefined;
    }
  }

  #renderRows() {
    const activeId = this.#activeSiteId();
    const rows = this.sites.map((site, index) => menuRow(
      String(index + 1),
      site.subtitle ? `${site.title} — ${site.subtitle}` : site.title,
      site.id === activeId,
    ));
    if (activeId !== null) rows.push(menuRow('0', 'Leave location', false));
    this.list.replaceChildren(...rows);
  }
}
