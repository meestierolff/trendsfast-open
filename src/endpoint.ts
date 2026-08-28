import { isIP } from "node:net";
import { REMOTE_MCP_ENDPOINT } from "./constants.js";
import { TrendsFastError } from "./errors.js";

export interface EndpointValidationOptions {
  allowLocalhost?: boolean;
  expectedOrigin?: string;
}

export function validateEndpoint(
  value: string,
  options: EndpointValidationOptions = {},
): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new TrendsFastError(
      "INVALID_ENDPOINT",
      "The MCP endpoint is not a valid URL.",
    );
  }

  const localhost =
    endpoint.hostname === "localhost" ||
    endpoint.hostname.endsWith(".localhost");
  if (
    endpoint.protocol !== "https:" &&
    !(options.allowLocalhost === true && localhost)
  ) {
    throw new TrendsFastError(
      "INVALID_ENDPOINT",
      "The MCP endpoint must use HTTPS.",
    );
  }
  if (endpoint.username !== "" || endpoint.password !== "") {
    throw new TrendsFastError(
      "INVALID_ENDPOINT",
      "Credentials are forbidden in the MCP endpoint URL.",
    );
  }
  if (endpoint.search !== "" || endpoint.hash !== "") {
    throw new TrendsFastError(
      "INVALID_ENDPOINT",
      "The MCP endpoint must not contain a query or fragment.",
    );
  }
  if (endpoint.pathname !== "/api/mcp") {
    throw new TrendsFastError(
      "INVALID_ENDPOINT",
      "The MCP endpoint path must be /api/mcp.",
    );
  }
  const hostForIp =
    endpoint.hostname.startsWith("[") && endpoint.hostname.endsWith("]")
      ? endpoint.hostname.slice(1, -1)
      : endpoint.hostname;
  if (isIP(hostForIp) !== 0) {
    throw new TrendsFastError(
      "INVALID_ENDPOINT",
      "IP-literal MCP endpoints are forbidden.",
    );
  }
  if (localhost && options.allowLocalhost !== true) {
    throw new TrendsFastError(
      "INVALID_ENDPOINT",
      "Localhost MCP endpoints are allowed only in test mode.",
    );
  }
  if (
    options.expectedOrigin !== undefined &&
    endpoint.origin !== options.expectedOrigin
  ) {
    throw new TrendsFastError(
      "INVALID_ENDPOINT",
      "The MCP endpoint origin does not match the expected origin.",
    );
  }
  return endpoint;
}

export function configuredEndpoint(value: string | undefined): URL {
  const allowLocalhost = process.env.TRENDSFAST_TEST_MODE === "1";
  const candidate = value ?? REMOTE_MCP_ENDPOINT;
  const parsed = validateEndpoint(candidate, { allowLocalhost });
  if (
    !allowLocalhost ||
    !(parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost"))
  ) {
    return validateEndpoint(candidate, {
      allowLocalhost,
      expectedOrigin: new URL(REMOTE_MCP_ENDPOINT).origin,
    });
  }
  return parsed;
}
