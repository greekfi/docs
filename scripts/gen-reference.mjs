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

// The API reference lists only the externally-usable surface, ordered read-first. forge doc
// documents every member — including `internal`/`private` functions and `modifier`s — so we
// drop those, parenthesise function headings, and reorder the survivors:
//   0 reads      — public state-var getters + constants, then `view`/`pure` functions
//   1 writes     — state-changing functions (and the constructor)
//   2 events
//   3 errors
// Each member is a `### name` block whose first ```solidity fence holds its declaration; the
// contract's leading prose / `### Subsection` description blocks (no fence) are kept up front.
function renderMembers(md) {
  const noGroups = md.replace(/^## .*$\n?/gm, ""); // strip forge's group headers
  const chunks = noGroups.split(/(?=^### )/m);
  const preamble = [];
  const members = [];
  chunks.forEach((chunk, i) => {
    if (i === 0 || !chunk.startsWith("### ")) return preamble.push(chunk);
    const fence = chunk.match(/```solidity\n([\s\S]*?)```/);
    if (!fence) return preamble.push(chunk); // description subsection, not a member
    const sig = fence[1];
    if (/\bmodifier\b/.test(sig) || /\b(internal|private)\b/.test(sig)) return; // drop
    const fn = sig.match(/\bfunction\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
    const text = fn ? chunk.replace(/^### .*$/m, `### ${fn[1]}(${fn[2].trim()})`) : chunk;
    let rank;
    if (/\bevent\b/.test(sig)) rank = 2;
    else if (/\berror\b/.test(sig)) rank = 3;
    else if (/\bconstructor\b/.test(sig)) rank = 1;
    else if (/\bfunction\b/.test(sig)) rank = /\b(view|pure)\b/.test(sig) ? 0 : 1;
    else rank = 0; // public state var / constant getter (read)
    members.push({ rank, i, text });
  });
  members.sort((a, b) => a.rank - b.rank || a.i - b.i); // stable: keep source order within a bucket
  return preamble.join("") + members.map((m) => m.text).join("");
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
      return `[${text}](#${contractTitle.toLowerCase()})`; // jump to the contract's <details> block
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
  // Filter to the public surface, sort read-first, and shift members (forge H3) up to H2 so
  // they sit one level under each contract's collapsible <details> block on the single page.
  return shiftHeadings(escapeJsxReferences(rewriteLinks(renderMembers(stripFirstH1(md)))), -1);
}

async function main() {
  // Single page; each contract is its own collapsible <details> block (id = anchor target).
  await fs.rm(path.join(ROOT, "docs", "docs", "reference"), { recursive: true, force: true });
  await fs.rm(path.join(ROOT, "docs", "docs", "api"), { recursive: true, force: true });

  const chunks = [
    frontmatter({
      title: "API Reference",
      sidebar_label: "API Reference",
      sidebar_position: 5,
      description: "Auto-generated per-contract reference rendered from NatSpec via forge doc.",
    }),
    "# API Reference",
    "",
    "Auto-generated from the NatSpec in `foundry/contracts/`. Each contract is collapsible; reads",
    "are listed before state-changing functions. Run `yarn docs:gen` from the repo root to refresh.",
    "",
  ];

  let count = 0;
  for (const section of SECTIONS) {
    for (const entry of section.entries) {
      const id = entry.title.toLowerCase();
      chunks.push(
        `<details id="${id}">`,
        `<summary><strong>${entry.title}</strong></summary>`,
        "",
        await loadEntry(entry),
        "",
        "</details>",
        "",
      );
      count += 1;
    }
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, chunks.join("\n"));
  console.log(`[docs:gen] wrote ${count} collapsible contracts → ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
