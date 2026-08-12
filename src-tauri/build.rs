fn main() {
    // Emit a per-var cfg so config.rs can bake an obfuscated credential
    // (obfstr) only when the var is present at build time. The runtime-.env
    // fallback (dev workflow) keeps working when the var is absent. Re-run
    // this build script whenever any of these vars changes so the baked
    // value (or its absence) stays in sync with the current environment.
    for var in [
        "TWITCH_CLIENT_ID",
        "TWITCH_CLIENT_SECRET",
        "OPENCRITIC_RAPIDAPI_KEY",
        "DISCORD_CLIENT_ID",
    ] {
        if std::env::var(var).is_ok() {
            println!("cargo:rustc-cfg=baked_{}", var);
        }
        println!("cargo:rustc-check-cfg=cfg(baked_{})", var);
        println!("cargo:rerun-if-env-changed={}", var);
    }
    tauri_build::build()
}
