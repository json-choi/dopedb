export type CosmicSceneRecipe = {
  seeds: [number, number, number, number];
  spin: number;
  tilt: number;
  horizon: number;
};

export const FALLBACK_COSMIC_RECIPE: CosmicSceneRecipe = {
  seeds: [1070272032, 3081820485, 2253728741, 3807220343],
  spin: 0.018,
  tilt: -0.075,
  horizon: 0.168,
};
