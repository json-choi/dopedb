//! Constant-size, read-only scene configuration for the Welcome artwork.
use super::{recipe, CosmicSceneRecipe};

#[tauri::command]
pub(crate) fn cosmic_scene_recipe() -> CosmicSceneRecipe {
    recipe()
}
