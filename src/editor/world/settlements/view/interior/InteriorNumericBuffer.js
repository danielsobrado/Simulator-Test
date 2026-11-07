/** A fixed page is at most 48 KiB, including while appending or finalizing. */
export const INTERIOR_BUFFER_PAGE_ELEMENTS = 12288;

/** Append without moving earlier values; consume pages in bounded copy steps. */
export class InteriorNumericBuffer {
  constructor(Type = Float32Array, pageElements = INTERIOR_BUFFER_PAGE_ELEMENTS) {
    if (!Number.isInteger(pageElements) || pageElements < 3) throw new Error('Interior buffer pages need at least three elements.');
    this.Type = Type;
    this.pageElements = pageElements;
    this.pages = [];
    this.current = null;
    this.length = 0;
    this.sealed = false;
  }

  push(a, b, c) {
    if (this.sealed) throw new Error('Cannot append to a finalized interior buffer.');
    const count = c !== undefined ? 3 : b !== undefined ? 2 : 1;
    let page = this.current;
    if (!page || page.length + count > this.pageElements) {
      page = { array: new this.Type(this.pageElements), length: 0 };
      this.pages.push(page);
      this.current = page;
    }
    page.array[page.length++] = a;
    if (count > 1) page.array[page.length++] = b;
    if (count > 2) page.array[page.length++] = c;
    this.length += count;
  }

  /** The owning batch bounds the destination size; source pages are released as copied. */
  *toArrayJob(onCopy = null) {
    if (this.sealed) throw new Error('Interior buffer finalization is single use.');
    this.sealed = true;
    this.current = null;
    const output = new this.Type(this.length);
    let offset = 0;
    for (let index = 0; index < this.pages.length; index++) {
      const page = this.pages[index];
      output.set(page.array.subarray(0, page.length), offset);
      offset += page.length;
      this.pages[index] = null;
      const bytes = page.length * this.Type.BYTES_PER_ELEMENT;
      onCopy?.(bytes);
      yield bytes;
    }
    this.pages.length = 0;
    return output;
  }
}
