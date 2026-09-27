export function isEditorSessionCurrent(currentEntryId: string | null | undefined, currentRevision: number, expectedEntryId: string | null | undefined, expectedRevision: number): boolean {
  return currentEntryId === expectedEntryId && currentRevision === expectedRevision;
}
