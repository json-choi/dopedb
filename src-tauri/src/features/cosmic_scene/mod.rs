//! Deterministic, allocation-free recipe for the decorative workbench cosmos.
//!
//! Rust owns the stable scene seed while the WebView GPU owns pixel rendering.
//! Sending full frames or particle arrays over IPC would multiply memory and copy
//! cost, so the wire payload deliberately remains a handful of scalar values.

use serde::Serialize;

pub(crate) mod transport;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CosmicSceneRecipe {
    seeds: [u32; 4],
    spin: f32,
    tilt: f32,
    horizon: f32,
}

pub(crate) fn recipe() -> CosmicSceneRecipe {
    let mut state = fnv1a64(b"dopedb:cosmic-workbench:v1");
    let mut seeds = [0_u32; 4];
    for seed in &mut seeds {
        state = splitmix64(state);
        *seed = (state >> 32) as u32;
    }
    CosmicSceneRecipe {
        seeds,
        spin: 0.018,
        tilt: -0.075,
        horizon: 0.168,
    }
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
    value ^ (value >> 31)
}
