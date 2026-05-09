// @ts-check
import { themes as prismThemes } from "prism-react-renderer";

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Greek",
  tagline: "Fully-collateralized options protocol",
  favicon: "img/helmet.svg",

  future: {
    v4: true,
  },

  url: "https://docs.greek.fi",
  baseUrl: "/",

  organizationName: "greekfi",
  projectName: "protocol",

  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.js",
          editUrl: "https://github.com/greekfi/protocol/tree/main/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: "Greek",
        items: [
          {
            to: "/fundamentals",
            label: "Fundamentals",
            position: "left",
            activeBaseRegex: "^/fundamentals",
          },
          {
            to: "/trading",
            label: "Trading",
            position: "left",
            activeBaseRegex: "^/trading",
          },
          {
            to: "/settlement",
            label: "Settlement",
            position: "left",
            activeBaseRegex: "^/settlement",
          },
          {
            to: "/api",
            label: "API Reference",
            position: "left",
            activeBaseRegex: "^/api",
          },
          {
            href: "https://github.com/greekfi/protocol",
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        links: [
          {
            title: "Docs",
            items: [
              { label: "Fundamentals", to: "/fundamentals" },
              { label: "Trading", to: "/trading" },
              { label: "Settlement", to: "/settlement" },
              { label: "API Reference", to: "/api" },
            ],
          },
          {
            title: "Code",
            items: [
              { label: "Protocol", href: "https://github.com/greekfi/protocol" },
              { label: "Web", href: "https://github.com/greekfi/web" },
            ],
          },
        ],
        copyright: `Greek — options that swap.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ["solidity"],
      },
    }),
};

export default config;
