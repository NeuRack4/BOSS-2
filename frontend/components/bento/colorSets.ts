export type ColorSet = {
  name: string;
  colors: string[];
};

export const COLOR_SETS: ColorSet[] = [
  {
    name: "Pastel Dreamland Adventure",
    colors: ["#cdb4db", "#ffc8dd", "#ffafcc", "#bde0fe", "#a2d2ff"],
  },
  {
    name: "Golden Summer Fields",
    colors: ["#ccd5ae", "#e9edc9", "#fefae0", "#faedcd", "#d4a373"],
  },
  {
    name: "Soft Peachy Delight",
    colors: [
      "#fec5bb",
      "#fcd5ce",
      "#fae1dd",
      "#f8edeb",
      "#e8e8e4",
      "#d8e2dc",
      "#ece4db",
      "#ffe5d9",
      "#ffd7ba",
      "#fec89a",
    ],
  },
  {
    name: "Pastel Rainbow Fantasy",
    colors: [
      "#ffadad",
      "#ffd6a5",
      "#fdffb6",
      "#caffbf",
      "#9bf6ff",
      "#a0c4ff",
      "#bdb2ff",
      "#ffc6ff",
      "#fffffc",
    ],
  },
  {
    name: "Soft Sand",
    colors: ["#edede9", "#d6ccc2", "#f5ebe0", "#e3d5ca", "#d5bdaf"],
  },
  {
    name: "Pastel Bliss",
    colors: ["#ffb5a7", "#fcd5ce", "#f8edeb", "#f9dcc4", "#fec89a"],
  },
  {
    name: "Peach Sorbet",
    colors: ["#f08080", "#f4978e", "#f8ad9d", "#fbc4ab", "#ffdab9"],
  },
  {
    name: "Pastel Dreams",
    colors: ["#ff99c8", "#fcf6bd", "#d0f4de", "#a9def9", "#e4c1f9"],
  },
  {
    name: "Soft Pastels",
    colors: ["#ffd6ff", "#e7c6ff", "#c8b6ff", "#b8c0ff", "#bbd0ff"],
  },
  {
    name: "Soft Pink Delight",
    colors: ["#ffe5ec", "#ffc2d1", "#ffb3c6", "#ff8fab", "#fb6f92"],
  },
  {
    name: "Soft Rainbow",
    colors: [
      "#fbf8cc",
      "#fde4cf",
      "#ffcfd2",
      "#f1c0e8",
      "#cfbaf0",
      "#a3c4f3",
      "#90dbf4",
      "#8eecf5",
      "#98f5e1",
      "#b9fbc0",
    ],
  },
  {
    name: "Pastel Dreamland",
    colors: [
      "#ffcbf2",
      "#f3c4fb",
      "#ecbcfd",
      "#e5b3fe",
      "#e2afff",
      "#deaaff",
      "#d8bbff",
      "#d0d1ff",
      "#c8e7ff",
      "#c0fdff",
    ],
  },
  {
    name: "Subtle Pastel Hues",
    colors: [
      "#eae4e9",
      "#fff1e6",
      "#fde2e4",
      "#fad2e1",
      "#e2ece9",
      "#bee1e6",
      "#f0efeb",
      "#dfe7fd",
      "#cddafd",
    ],
  },
  {
    name: "Pastel Rainbow",
    colors: ["#70d6ff", "#ff70a6", "#ff9770", "#ffd670", "#e9ff70"],
  },
  {
    name: "Blue Serenity",
    colors: [
      "#edf2fb",
      "#e2eafc",
      "#d7e3fc",
      "#ccdbfd",
      "#c1d3fe",
      "#b6ccfe",
      "#abc4ff",
    ],
  },
  {
    name: "Pastel Fantasy",
    colors: ["#7bdff2", "#b2f7ef", "#eff7f6", "#f7d6e0", "#f2b5d4"],
  },
  {
    name: "Soft Pastel Shades",
    colors: [
      "#eddcd2",
      "#fff1e6",
      "#fde2e4",
      "#fad2e1",
      "#c5dedd",
      "#dbe7e4",
      "#f0efeb",
      "#d6e2e9",
      "#bcd4e6",
      "#99c1de",
    ],
  },
];

// Flat deduplicated list of all colors across all sets
export const ALL_COLORS: string[] = [
  ...new Set(COLOR_SETS.flatMap((s) => s.colors)),
];
