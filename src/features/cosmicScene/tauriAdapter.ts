import { isTauri } from "@tauri-apps/api/core";
import { queryOptions } from "@tanstack/react-query";

import { invoke } from "../../ipc/core";
import {
  FALLBACK_COSMIC_RECIPE,
  type CosmicSceneRecipe,
} from "./domain";

export const cosmicSceneOptions = queryOptions({
  queryKey: ["cosmicSceneRecipe"],
  queryFn: loadCosmicSceneRecipe,
  staleTime: Infinity,
  gcTime: 0,
});

export async function loadCosmicSceneRecipe(): Promise<CosmicSceneRecipe> {
  if (!isTauri()) return FALLBACK_COSMIC_RECIPE;
  try {
    return await invoke<CosmicSceneRecipe>("cosmic_scene_recipe");
  } catch {
    // Decoration must not block the workbench if native startup is incomplete.
    return FALLBACK_COSMIC_RECIPE;
  }
}
