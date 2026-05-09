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
      { from: "Collateral.sol/contract.Collateral.md", title: "Collateral" },
      { from: "Factory.sol/contract.Factory.md", title: "Factory" },
      { from: "YieldVault.sol/contract.YieldVault.md", title: "YieldVault" },
      { from: "OptionUtils.sol/library.OptionUtils.md", title: "OptionUtils" },
    ],
  },
  {
    label: "Oracles",
    entries: [
      { from: "oracles/IPriceOracle.sol/interface.IPriceOracle.md", title: "IPriceOracle" },
      { from: "oracles/UniV3Oracle.sol/contract.UniV3Oracle.md", title: "UniV3Oracle" },
    ],
  },
  {
    label: "Interfaces",
    entries: [
      { from: "interfaces/IOption.sol/interface.IOption.md", title: "IOption" },
      { from: "interfaces/ICollateral.sol/interface.ICollateral.md", title: "ICollateral" },
      { from: "interfaces/IFactory.sol/interface.IFactory.md", title: "IFactory" },
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

function rewriteLinks(md) {
  // Walk `[text](href)` pairs. In the single-page layout every link either collapses to
  // an anchor on the same page (for known first-party contracts) or gets unlinked
  // (for third-party / unknown targets), since there's nowhere else to send the reader.
  return md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, href) => {
    if (href.startsWith("#")) return match; // intra-doc anchor already
    if (/^https?:\/\//.test(href)) return match; // external link

    // forge-doc internal: e.g. "/contracts/Option.sol/contract.Option.md#mint"
    const m = href.match(/\/([^/]+\.sol)\/[^/]+\.md(#.+)?$/);
    if (m && KNOWN_SOL.has(m[1])) {
      const anchor = m[2] || "";
      if (anchor) return `[${text}](${anchor})`;
      // No anchor → point at the contract's H3 (slugified from title).
      const contractTitle = m[1].replace(/\.sol$/, "");
      return `[${text}](#${contractTitle.toLowerCase()})`;
    }
    // Unknown internal (third-party IERC1271 etc.) — drop link, keep label as inline code.
    return "`" + text + "`";
  });
}

// MDX parses {X} as a JS expression. Our NatSpec uses {ContractName} as cross-references,
// so we walk the markdown outside of code blocks and backtick them.
function escapeJsxReferences(md) {
  const parts = md.split(/(^```[\s\S]*?^```)/m);
  return parts
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      return segment
        .split(/(`[^`\n]*`)/g)
        .map((chunk, j) => {
          if (j % 2 === 1) return chunk;
          return chunk.replace(/\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g, "`$1`");
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
        const level = Math.min(6, hashes.length + by);
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
  return shiftHeadings(escapeJsxReferences(rewriteLinks(stripFirstH1(md))), 2);
}

async function main() {
  // Clean up any prior output from earlier iterations of this script.
  await fs.rm(path.join(ROOT, "docs", "docs", "reference"), { recursive: true, force: true });

  const chunks = [
    frontmatter({
      title: "API Reference",
      sidebar_label: "API Reference",
      sidebar_position: 2,
      description: "Auto-generated per-contract reference rendered from NatSpec via forge doc.",
    }),
    "# API Reference",
    "",
    "Auto-generated from the NatSpec in `foundry/contracts/`. Edit the Solidity source and run",
    "`yarn docs:gen` from the repo root to refresh this page.",
    "",
  ];

  let count = 0;
  for (const section of SECTIONS) {
    chunks.push(`## ${section.label}`, "");
    for (const entry of section.entries) {
      chunks.push(`### ${entry.title}`, "", await loadEntry(entry), "");
      count++;
    }
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, chunks.join("\n"));
  console.log(`[docs:gen] wrote ${count} contracts → ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
