import React, { useEffect, useState, useCallback } from "react";
import clsx from "clsx";
import OriginalLink from "@theme-original/DocSidebarItem/Link";
import { isActiveSidebarItem } from "@docusaurus/plugin-content-docs/client";

function useCurrentDocTOC() {
  const read = () =>
    typeof window !== "undefined" ? window.__greekDocToc : null;
  const [state, setState] = useState(read);
  useEffect(() => {
    const handler = () => setState(read());
    window.addEventListener("greek-toc-update", handler);
    handler();
    return () => window.removeEventListener("greek-toc-update", handler);
  }, []);
  return state;
}

function useActiveHash() {
  const [hash, setHash] = useState(() =>
    typeof window !== "undefined" ? window.location.hash.slice(1) : "",
  );
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.slice(1));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash;
}

function SidebarTOC({ toc }) {
  const activeHash = useActiveHash();
  const items = toc ?? [];
  if (!items.length) return null;
  const minLevel = Math.min(...items.map((h) => h.level ?? 2));
  return (
    <ul className="sidebar-toc-list">
      {items.map((h) => {
        const depth = (h.level ?? minLevel) - minLevel;
        const isActive = activeHash === h.id;
        return (
          <li className="menu__list-item" key={h.id}>
            <a
              className={clsx("menu__link sidebar-toc-link", {
                "sidebar-toc-link--active": isActive,
              })}
              href={`#${h.id}`}
              style={{ paddingLeft: `calc(0.75rem + ${depth * 1}rem)` }}
            >
              {h.value}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export default function DocSidebarItemLinkWrapper(props) {
  const { item, activePath } = props;
  const cur = useCurrentDocTOC();
  const isActive = isActiveSidebarItem(item, activePath);
  const isCurrentDoc = cur && item.docId && cur.docId === item.docId;
  const toc = isActive && isCurrentDoc ? cur.toc : null;

  return (
    <>
      <OriginalLink {...props} />
      {toc && toc.length > 0 && <SidebarTOC toc={toc} />}
    </>
  );
}
