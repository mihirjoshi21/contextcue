/** Fires exactly once per distinct non-null sharedAnswer id (polling would re-deliver it). */
export class SharedAnswerDeduper {
  private last: string | null = null;

  shouldHandle(id: string | null | undefined): boolean {
    if (id == null || id === '') return false;
    if (id === this.last) return false;
    this.last = id;
    return true;
  }

  reset(): void {
    this.last = null;
  }
}
