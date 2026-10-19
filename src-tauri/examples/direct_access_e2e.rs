//! Runs one direct-access scenario command against a Docker target (see
//! `scripts/test-direct-provisioning.mjs`): the request JSON is argv[1], the result
//! JSON is the last stdout line.

#[tokio::main]
async fn main() {
    let request = std::env::args().nth(1).unwrap_or_default();
    let result = app_lib::direct_access_e2e::run(&request).await;
    println!("{result}");
}
