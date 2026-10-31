/** What the CLI package exports besides its bin: the sign-in seal opener, so the server's
 * interop test can open what its sealer produces, and `main` for in-process tests. */
export { openCliCredential, generateLoginKeyPair, generateLoginState, SealError, CLI_LOGIN_HKDF_INFO, CLI_LOGIN_SEAL_VERSION } from "./login/seal.js";
export type { CliCredential } from "./login/seal.js";
export { main } from "./main.js";
