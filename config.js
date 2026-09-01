/*
 * Frontend runtime configuration.
 *
 * For Cloudflare mode set backendUrl to your Worker URL.
 * Keep backendUrl empty to use the original direct Azure DevOps PAT mode.
 */
window.AZDO_CONFIG = {
  backendUrl: '',
  backendMode: false
};
