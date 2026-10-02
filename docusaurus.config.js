// @ts-check
import { themes as prismThemes } from "prism-react-renderer";

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Greek",
  tagline: "Fully-collateralized options protocol",
  favicon: "img/greek-helmet.svg",

  future: {
    v4: true,
  },

  url: "https://docs.greek.fi",
  baseUrl: "/",

  organizationName: "greekfi",
  projectName: "docs",

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
        defaultMode: "light",
        respectPrefersColorScheme: false,
        disableSwitch: true,
      },
      navbar: {
        logo: {
          alt: "Greek Fi",
          src: "img/greek-logo.svg",
        },
        hideOnScroll: false,
        items: [
          {
            href: "https://greek.fi",
            label: "Greek.fi",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        links: [
          {
            title: "Greek",
            items: [
              { label: "Greek.fi", href: "https://greek.fi" },
              { label: "Documentation", to: "/" },
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
