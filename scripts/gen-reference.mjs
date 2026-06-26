#!/usr/bin/env node
// Post-process `forge doc` output into a single-page Docusaurus API reference at
// docs/reference/api.md. Organised by section headers (Core / Oracles / Interfaces),
// no nested sidebar.
//
// Expects `forge doc --out docs` to have been run from the foundry workspace beforehand
// (`yarn workspace @greek/foundry docs:gen`). Run via `yarn docs:gen` from the root,
// which invokes the foundry step then this script.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "foundry", "docs", "src", "contracts");
const OUT_FILE = path.join(ROOT, "docs", "docs", "api.md");

// What to include, grouped for section headers. `from` is relative to forge-doc's
// `src/contracts/` output.
const SECTIONS = [
  {
    label: "Core Contracts",
    entries: [
      { from: "Option.sol/contract.Option.md", title: "Option" },
      { from: "Receipt.sol/contract.Receipt.md", title: "Receipt" },
      { from: "Factory.sol/contract.Factory.md", title: "Factory" },
    ],
  },
];

const KNOWN_SOL = new Set(
  SECTIONS.flatMap((s) => s.entries.map((e) => e.from.split("/")[0].replace(/^oracles\/|^interfaces\//, ""))),
);
// The `from` paths are shaped like `Foo.sol/...` or `oracles/Foo.sol/...`. Collect just the
// `Foo.sol` component so we can recognise which forge-doc cross-links are first-party.
for (const s of SECTIONS) {
  for (const e of s.entries) {
    const parts = e.from.split("/");
    KNOWN_SOL.add(parts[parts.length - 2]); // "<ContractName>.sol"
  }
}

function stripFirstH1(md) {
  // forge doc leads each file with `# <ContractName>` + a `[Git Source](...)` line, then
  // optionally `**Inherits:**` / `**Title:**` / `**Author:**` metadata blocks. Drop the
  // H1 + Git-source, keep the rest — **Title** etc. is useful context.
  const lines = md.split("\n");
  while (lines.length && (lines[0].trim() === "" || /^#\s/.test(lines[0]) || lines[0].startsWith("[Git Source]"))) {
    lines.shift();
  }
  return lines.join("\n");
}

// The API reference should list only the externally-usable surface. forge doc documents
// every member — including `internal`/`private` functions and `modifier`s — so drop those
// `### member` sections, keeping public/external functions, public state-var getters, events,
// errors, structs and constants. Each member is a `### name` block whose first ```solidity
// fence holds its declaration; `## Section` headers ride along on the preceding member's tail
// so they survive even when that member is dropped.
function stripNonPublicMembers(md) {
  const chunks = md.split(/(?=^### )/m);
  return chunks
    .map((chunk, i) => {
      if (i === 0 || !chunk.startsWith("### ")) return chunk;
      const h2 = chunk.search(/^## /m); // a following "## Section" header, if any
      const body = h2 === -1 ? chunk : chunk.slice(0, h2);
      const tail = h2 === -1 ? "" : chunk.slice(h2);
      const fence = body.match(/```solidity\n([\s\S]*?)```/);
      const sig = fence ? fence[1] : "";
      // Drop anything not part of the external surface: internal/private members (functions
      // AND state variables) and modifiers. Public/external functions, public state-var
      // getters, constants, events, errors and structs (no internal/private keyword) stay.
      const drop = /\bmodifier\b/.test(sig) || /\b(internal|private)\b/.test(sig);
      if (drop) return tail;
      // Show functions with their parenthesised parameter list as the heading.
      const fn = sig.match(/\bfunction\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
      const out = fn ? body.replace(/^### .*$/m, `### ${fn[1]}(${fn[2].trim()})`) : body;
      return out + tail;
    })
    .join("");
}

function rewriteLinks(md) {
  // Walk `[text](href)` pairs. In the single-page layout every link either collapses to
  // an anchor on the same page (for known first-party contracts) or gets unlinked
  // (for third-party / unknown targets), since there's nowhere else to send the reader.
  return md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, href) => {
    if (/^https?:\/\//.test(href)) return match; // external link

    // forge-doc internal: e.g. "/contracts/Option.sol/contract.Option.md#mint".
    // We parenthesise function headings (and drop internal members), so member-level
    // anchors are no longer stable. Collapse every internal ref to the owning contract's
    // section heading — always valid, and lands the reader in the right place.
    const m = href.match(/\/([^/]+\.sol)\/[^/]+\.md(?:#.+)?$/);
    if (m && KNOWN_SOL.has(m[1])) {
      const contractTitle = m[1].replace(/\.sol$/, "");
      return `[${text}](/api/${contractTitle.toLowerCase()})`;
    }
    if (href.startsWith("#")) return "`" + text + "`"; // stale same-page member anchor → unlink
    // Unknown internal (third-party IERC1271 etc.) — drop link, keep label as inline code.
    return "`" + text + "`";
  });
}

// MDX parses {X} as a JS expression. Our NatSpec uses {ContractName} and function-signature
// cross-references like {exerciseFor(address,uint256)} — both must be backticked or MDX tries to
// evaluate them (e.g. "exerciseFor is not defined"). We walk the markdown outside of code blocks
// and backtick every brace group in prose (generated reference has no intentional JSX).
function escapeJsxReferences(md) {
  const parts = md.split(/(^```[\s\S]*?^```)/m);
  return parts
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      return segment
        .split(/(`[^`\n]*`)/g)
        .map((chunk, j) => {
          if (j % 2 === 1) return chunk;
          return chunk.replace(/\{([^{}\n]+)\}/g, "`$1`");
        })
        .join("");
    })
    .join("");
}

// Demote every markdown heading by `by` levels so per-contract content slots under the
// single-page structure (## Section → ### Contract → #### Fn category → ##### fn).
function shiftHeadings(md, by) {
  const parts = md.split(/(^```[\s\S]*?^```)/m);
  return parts
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      return segment.replace(/^(#{1,6}) /gm, (_m, hashes) => {
        const level = Math.max(1, Math.min(6, hashes.length + by));
        return "#".repeat(level) + " ";
      });
    })
    .join("");
}

function frontmatter({ title, sidebar_label, description, sidebar_position }) {
  return [
    "---",
    `title: ${title}`,
    `sidebar_label: ${sidebar_label}`,
    sidebar_position !== undefined ? `sidebar_position: ${sidebar_position}` : null,
    description ? `description: ${JSON.stringify(description)}` : null,
    "---",
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

async function loadEntry(entry) {
  const src = path.join(SRC, entry.from);
  let md;
  try {
    md = await fs.readFile(src, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error(`[docs:gen] missing ${src} — did you run \`yarn workspace @greek/foundry docs:gen\` first?`);
    }
    throw e;
  }
  // Drop forge-doc's per-contract group headers (## Constants / State Variables / Functions /
  // Events / Errors / …) — the members read fine without category titles. The contract title
  // is emitted by main(); members stay at H3 beneath it (no level shift).
  const stripped = stripNonPublicMembers(stripFirstH1(md)).replace(/^## .*$\n?/gm, "");
  // Each contract is its own page with an H1 title; members (forge H3) shift up to H2.
  return shiftHeadings(escapeJsxReferences(rewriteLinks(stripped)), -1);
}

async function main() {
  const OUT_DIR = path.join(ROOT, "docs", "docs", "api");
  // Reset prior output: the old single page, the directory, and any earlier "reference" dir.
  await fs.rm(path.join(ROOT, "docs", "docs", "reference"), { recursive: true, force: true });
  await fs.rm(OUT_FILE, { force: true });
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  let pos = 0;
  let count = 0;
  for (const section of SECTIONS) {
    for (const entry of section.entries) {
      pos += 1;
      const slug = `/api/${entry.title.toLowerCase()}`;
      const fm = ["---", `title: ${entry.title}`, `sidebar_label: ${entry.title}`, `sidebar_position: ${pos}`, `slug: ${slug}`, "---", ""].join("\n");
      const body = [`# ${entry.title}`, "", await loadEntry(entry), ""].join("\n");
      await fs.writeFile(path.join(OUT_DIR, `${entry.title.toLowerCase()}.md`), fm + body);
      count += 1;
    }
  }
  console.log(`[docs:gen] wrote ${count} contract pages → ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
