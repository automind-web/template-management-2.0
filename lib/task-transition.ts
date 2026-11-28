/** An optional report is not a reason to interrupt a drag or a quick action. */
export function needsTransitionForm(requires: { comment: boolean; resultText: boolean; attachment: boolean }, attachmentCount: number): boolean {
  return requires.comment || requires.resultText || (requires.attachment && attachmentCount === 0);
}
