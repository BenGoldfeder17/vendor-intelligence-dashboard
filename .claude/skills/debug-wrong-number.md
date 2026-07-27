# A number looks wrong

Route to **`data-integrity`** first — do not start editing.

1. Reproduce with the **real** file/data, not a fixture.
2. Inspect raw input (`head -5`, header enumeration).
3. Derive units from the data (division identities, magnitude checks).
4. Locate the transform that introduced the error.
5. Fix, then show before/after side by side.

Most likely causes, in order:
`percent()` double-scale · basis-points read as percent · header offset ·
per-code value compared to a global constant · a field dropped at an interface.
