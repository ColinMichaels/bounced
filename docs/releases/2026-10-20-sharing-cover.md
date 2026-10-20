# Bounced sharing cover

The homepage now exposes static Open Graph and Twitter large-image metadata using
the same Bounced cover as the ColinMichaels.com recommended link. The dated PNG is
served from `public/social/bounced-cover-20261020.png`, with an absolute GitHub
Pages URL, dimensions, and accessible image description.

The cover was generated with OpenAI image generation on October 20, 2026. It is
conceptual promotional artwork, not a gameplay screenshot.

Base source: `577e76194da0035f6a962139489fcd73a2ec4f3e`.
Previous published Pages revision: `e6782bdc468cc939ac7bf8b0bd8214b35e40a97f`.

Validation:

- `npm ci` completed using the existing lockfile.
- `npm run build:pages` passed, including TypeScript checking.
- Built gameplay assets, client page, and summary page match the previous
  published Pages revision byte-for-byte.
- The built PNG matches the original cover; SHA-256:
  `2cc5ae583dcfc379ffd56469563f76f7251ba70a4ffa3330a7fc4cd7be9accb5`.
- The existing dependency audit reports 10 high severity vulnerabilities.
  Dependency updates are outside this metadata-only change.

Publish using the existing Deploy GitHub Pages workflow. To roll back, deploy the
base source revision above, or revert the sharing-cover commit and redeploy.
Social platforms may retain cached previews until they scrape the page again.
