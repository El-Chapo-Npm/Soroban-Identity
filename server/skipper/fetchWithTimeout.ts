/**\n * Fetch with Timeout\n *\n * Wraps the native fetch API with timeout protection using AbortController.\n * Prevents hanging requests on slow or unresponsive RPC endpoints.\n */\n\n/**\n * Custom error thrown when a fetch request exceeds the timeout duration.\n */\nexport class TimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}\n\n/**\n * Fetches a URL with timeout protection.\n *\n * @param url - The URL to fetch\n * @param options - Standard fetch options (headers, method, body, etc.)\n * @param timeoutMs - Timeout duration in milliseconds. Defaults to 10000 (10 seconds)\n * @returns Promise<Response> - Resolves with the fetch response if successful before timeout\n * @throws TimeoutError - If timeout expires before request completes\n * @throws Original fetch error - If request fails for other reasons\n */\nexport async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    // Check if error is due to abort (timeout)\n    if (error instanceof Error && error.name === "AbortError") {
      throw new TimeoutError(url, timeoutMs);
    }

    // Propagate original error\n    throw error;
  }
}\n\n/**\n * Fetches the current base fee from Horizon.\n *\n * The Horizon /fee endpoint returns the current network base fee in stroops.\n * @param horizonUrl - Horizon server URL. Defaults to testnet.\n * @returns Promise resolving to the base fee in stroops.\n * @throws Error if the request fails or the response is unexpected.\n */\nexport async function fetchBaseFeeFromHorizon(
  horizonUrl: string = "https://horizon-testnet.stellar.org",
): Promise<number> {
  const response = await fetchWithTimeout(
    `${horizonUrl}/fee`,
    { method: "GET" },
    10000,
  );
  const data = await response.json();
  if (typeof data.fee !== "string" && typeof data.fee !== "number") {
    throw new Error("Unexpected Horizon /fee response: missing or invalid fee");
  }
  const fee = Number(data.fee);
  if (isNaN(fee) || fee <= 0) {
    throw new Error("Invalid base fee received from Horizon");
  }
  return fee;
}\n