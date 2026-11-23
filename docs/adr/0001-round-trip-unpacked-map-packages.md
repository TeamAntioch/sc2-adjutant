# Round-Trip Unpacked Map Packages with Layer Locking

We compile each `Mission Blueprint` into an unpacked `.SC2Map` component directory (`Map Package`) rather than a one-way binary archive, assigning stable IDs to Blueprint-managed objects, regions, and triggers while allowing terrain and decorative object layers to be locked or synced back. Galaxy Editor is essential for visual validation, cliff/lighting calculation, and manual spatial polish; destructive one-way generation would erase Editor refinements whenever mission logic or dialogue is recompiled from the CLI.

The layer locking was never built. [ADR-0010](./0010-compiled-and-kept-content.md) replaces it: each part of a committed Map Package is Compiled Content or Kept Content, and a compile record tells them apart.
