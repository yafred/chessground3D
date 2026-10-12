{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:
let
  pkgs-master = import inputs.nixpkgs-master { system = pkgs.stdenv.system; };
  pkgs-unstable = import inputs.nixpkgs-unstable { system = pkgs.stdenv.system; };
in
{
  env = {
    pnpm_config_pm_on_fail = "error";
  };

  # https://devenv.sh/languages/
  languages = {
    javascript = {
      enable = false; # it adds node_modules/.bin to the $PATH!
    };
  };

  packages = [
    pkgs-unstable.nodejs-slim
    pkgs-master.pnpm_12
    pkgs-master.oxlint
    pkgs-master.oxfmt
    pkgs-master.tsgolint
  ];
}
