import React, { useEffect } from "react";
import OriginalLayout from "@theme-original/DocItem/Layout";
import { useDoc } from "@docusaurus/plugin-content-docs/client";

export default function LayoutWrapper(props) {
  const { toc, metadata } = useDoc();
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.__greekDocToc = { docId: metadata.id, toc: toc ?? [] };
    window.dispatchEvent(new Event("greek-toc-update"));
    return () => {
      window.__greekDocToc = null;
      window.dispatchEvent(new Event("greek-toc-update"));
    };
  }, [metadata.id, toc]);
  return <OriginalLayout {...props} />;
}
