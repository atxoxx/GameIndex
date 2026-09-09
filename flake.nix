{
  description = "GameIndex - Unified cross-store game launcher and library manager";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forEachSupportedSystem = f: nixpkgs.lib.genAttrs supportedSystems (system: f {
        pkgs = import nixpkgs { inherit system; };
        inherit system;
      });
    in
    {
      devShells = forEachSupportedSystem ({ pkgs, system }:
        let
          # Linux GUI & runtime libraries required by Tauri v2 and GameIndex crates
          linuxLibraries = with pkgs; [
            webkitgtk_4_1
            gtk3
            cairo
            gdk-pixbuf
            glib
            dbus
            openssl
            librsvg
            libsoup_3
            pango
            harfbuzz
            atk
            libappindicator-gtk3
            gsettings-desktop-schemas
            # Required for rquickjs C-binding generation via bindgen
            llvmPackages.libclang.lib
            clang
          ];

          # macOS SDK frameworks
          darwinLibraries = with pkgs; [
            darwin.apple_sdk.frameworks.Security
            darwin.apple_sdk.frameworks.CoreServices
            darwin.apple_sdk.frameworks.WebKit
            darwin.apple_sdk.frameworks.AppKit
          ];

          # Development and build tooling
          devTools = with pkgs; [
            pkg-config
            nodejs_22
            cargo
            rustc
            rustfmt
            clippy
            rust-analyzer
            cargo-tauri
          ];

          targetLibraries = if pkgs.stdenv.isLinux then linuxLibraries else darwinLibraries;
        in
        {
          default = pkgs.mkShell {
            nativeBuildInputs = devTools ++ [ pkgs.pkg-config ];
            buildInputs = targetLibraries;

            shellHook = if pkgs.stdenv.isLinux then ''
              # Dynamic linker library path for WebKitGTK and Tao/GTK3
              export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath linuxLibraries}:$LD_LIBRARY_PATH"

              # pkg-config search path for Cargo build scripts
              export PKG_CONFIG_PATH="${pkgs.lib.makeSearchPathOutput "dev" "lib/pkgconfig" linuxLibraries}:$PKG_CONFIG_PATH"

              # Clang library path for bindgen / rquickjs
              export LIBCLANG_PATH="${pkgs.llvmPackages.libclang.lib}/lib"

              # GSettings schemas to prevent GLib/GTK schema lookup runtime errors
              export GSETTINGS_SCHEMA_DIR="${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}/glib-2.0/schemas"
              export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"

              echo "🎮 GameIndex Nix development shell loaded (Tauri v2 + Node 22 + Rust)!"
            '' else ''
              echo "🎮 GameIndex Nix development shell loaded (macOS)!"
            '';
          };
        }
      );

      formatter = forEachSupportedSystem ({ pkgs, ... }: pkgs.nixpkgs-fmt);
    };
}
