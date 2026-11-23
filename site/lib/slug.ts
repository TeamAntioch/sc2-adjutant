// Text as an anchor id, as a hand-written page's headings and a tutorial's objectives get theirs.
// The reference script imports it as well as the pages, so it imports nothing.
export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** A tutorial step's anchor: the <Objective>'s `id`, else its title as a slug. */
export function objectiveId<Id>(id: Id | undefined, title: string): Id | string {
  return id ?? slugOf(title);
}
