Edit the journal CSS and JavaScript source modules, then run `npm run build:journal-assets`.
The script commits no changes itself: it writes the ordered stylesheet, head modules and runtime modules with content hashes and updates `journal.html` to point to them. Commit those generated files alongside the sources. The existing static hosting workflow deploys the checked-in assets without an additional build step.

Keep `journal-atlas.css` last in the stylesheet list. Head modules retain their original declaration order; live streams and ledger modules run after the page's inline definitions. Optional XLSX and screenshot libraries are loaded by `journal-loader.js` only when requested.

The supplied icon WebP files preserve pixels losslessly. The three large scenery WebP files use quality 88; the original PNG artwork remains in the repository.
