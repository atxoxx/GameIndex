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
        "STEAMGRIDDB_API_KEY",
    ] {
        if std::env::var(var).is_ok() {
            println!("cargo:rustc-cfg=baked_{}", var);
        }
        println!("cargo:rustc-check-cfg=cfg(baked_{})", var);
        println!("cargo:rerun-if-env-changed={}", var);
    }
    // Test executables link comctl32's `TaskDialogIndirect` (through the dialog
    // plugin), a Common-Controls v6-only export. `tauri-build` embeds the v6
    // manifest into the app binary only, so without one Windows resolves the
    // import against comctl32 v5 and the loader aborts with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) before any test runs. Delay-
    // loading comctl32 keeps that import out of the load-time resolution; the
    // app still loads v6 on first use through its manifest.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg=/DELAYLOAD:comctl32.dll");
        println!("cargo:rustc-link-arg=/DEFAULTLIB:delayimp.lib");
    }
    tauri_build::build()
}
