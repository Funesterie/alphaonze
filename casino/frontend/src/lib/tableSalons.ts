export type TableSalonMeta = {
  id: string;
  title: string;
  chip: string;
  blurb: string;
};

export const BLACKJACK_SALONS: TableSalonMeta[] = [
  {
    id: "lantern-quay",
    title: "Lantern Quay",
    chip: "Salon principal",
    blurb: "Table lisible, croupier en vue et flux calme pour jouer vite.",
  },
  {
    id: "bat-parlor",
    title: "Bat Parlor",
    chip: "Canal rapide",
    blurb: "Cadence plus nerveuse, ambiance feutree et jetons qui tournent vite.",
  },
  {
    id: "scream-lounge",
    title: "Scream Lounge",
    chip: "Table noire",
    blurb: "Salon nocturne pour suivre les autres joueurs sans perdre la lecture.",
  },
];

export const POKER_SALONS: TableSalonMeta[] = [
  {
    id: "allmight-ring",
    title: "Allmight Ring",
    chip: "Table phare",
    blurb: "Le grand ovale hold'em, propre et lisible, pour voir le ring au complet.",
  },
  {
    id: "upstream-port",
    title: "Upstream Port",
    chip: "Canal cash",
    blurb: "Une table plus directe, pensée pour enchaîner les mains rapidement.",
  },
  {
    id: "captains-table",
    title: "Captain's Table",
    chip: "Salon prive",
    blurb: "Un coin plus calme pour voir qui rejoint et garder le board bien lisible.",
  },
];
