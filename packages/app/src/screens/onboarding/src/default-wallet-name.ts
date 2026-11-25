// Crystal- or light-sounding, and colourless on purpose: a wallet's avatar
// has its own colour, and a name like "Ruby" on a blue avatar would read as
// the wrong wallet.
const DEFAULT_WALLET_NAMES = [
  "Brilliant",
  "Clarity",
  "Clear Quartz",
  "Crystal",
  "Dazzle",
  "Diamond",
  "Facet",
  "Blaze",
  "Flicker",
  "Glimmer",
  "Glint",
  "Glisten",
  "Glow",
  "Halo",
  "Lucent",
  "Lumen",
  "Lustre",
  "Mirror",
  "Nova",
  "Photon",
  "Prism",
  "Quartz",
  "Radiant",
  "Ray",
  "Rock Crystal",
  "Sheen",
  "Shimmer",
  "Spark",
  "Sparkle",
  "Spectrum",
  "Starlight",
  "Twinkle",
  "Zircon",
];

export function randomDefaultWalletName(): string {
  return DEFAULT_WALLET_NAMES[Math.floor(Math.random() * DEFAULT_WALLET_NAMES.length)]!;
}
